#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#ifndef HWELP_VERSION
#define HWELP_VERSION "0.1.0"
#endif

#define MAX_ROUTES 64
#define HDR_MAX 65536
#define CONN_MS 5000
#define SESSION_LOG_MIN_BYTES 16384ULL
#define SESSION_LOG_MIN_MS 2000ULL

enum scheme { DIRECT, SOCKS5, HTTPP };

struct route {
    char id[64];
    char label[160];
    char host[256];
    char user[256];
    char pass[256];
    int port;
    enum scheme s;
    bool auth;
};

struct req {
    bool connect;
    char method[16];
    char host[256];
    char path[4096];
    char ver[16];
    int port;
};

struct traffic {
    uint64_t client_to_upstream;
    uint64_t upstream_to_client;
};

static const char *listen_host = "127.0.0.1";
static const char *routes_file = "/tmp/podkop_bot/bearhole/routes.conf";
static const char *current_file = "/tmp/podkop_bot/bearhole/current";
static const char *auth_file = NULL;
static const char *activity_log_file = NULL;
static int listen_port = 1066;
static bool local_auth = false;
static char local_user[256];
static char local_pass[256];

static void hlog(int priority, const char *fmt, ...)
{
    char msg[1024], line[1200];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);
    syslog(priority, "%s", msg);

    if (activity_log_file && *activity_log_file) {
        int n = snprintf(line, sizeof(line), "%lld hwelp %s\n", (long long)time(NULL), msg);
        if (n > 0) {
            int fd = open(activity_log_file, O_WRONLY | O_CREAT | O_APPEND, 0600);
            if (fd >= 0) {
                size_t len = (size_t)n < sizeof(line) ? (size_t)n : sizeof(line) - 1;
                (void)write(fd, line, len);
                close(fd);
            }
        }
    }
}

static unsigned long long monotonic_ms(void)
{
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0)
        return 0;
    return (unsigned long long)ts.tv_sec * 1000ULL + (unsigned long long)ts.tv_nsec / 1000000ULL;
}

static const char *scheme_name(enum scheme s)
{
    switch (s) {
    case SOCKS5: return "SOCKS5";
    case HTTPP: return "HTTP";
    default: return "Direct";
    }
}

static void human_bytes(uint64_t n, char *buf, size_t sz)
{
    if (n >= 1024ULL * 1024ULL)
        snprintf(buf, sz, "%.1f MiB", (double)n / (1024.0 * 1024.0));
    else if (n >= 1024ULL)
        snprintf(buf, sz, "%.1f KiB", (double)n / 1024.0);
    else
        snprintf(buf, sz, "%llu B", (unsigned long long)n);
}

static int parse_hostport(const char *x, int default_port, char *host, size_t host_sz, int *port)
{
    const char *end, *colon;
    if (!x || !*x)
        return -1;

    if (*x == '[') {
        end = strchr(x, ']');
        if (!end || (size_t)(end - x - 1) >= host_sz)
            return -1;
        memcpy(host, x + 1, (size_t)(end - x - 1));
        host[end - x - 1] = 0;
        *port = end[1] == ':' ? atoi(end + 2) : default_port;
    } else {
        colon = strrchr(x, ':');
        if (colon && strchr(x, ':') == colon) {
            size_t n = (size_t)(colon - x);
            if (!n || n >= host_sz)
                return -1;
            memcpy(host, x, n);
            host[n] = 0;
            *port = atoi(colon + 1);
        } else {
            if (strlen(x) >= host_sz)
                return -1;
            strcpy(host, x);
            *port = default_port;
        }
    }
    return *port > 0 && *port < 65536 ? 0 : -1;
}

static int hexval(int c)
{
    if (c >= '0' && c <= '9') return c - '0';
    c |= 32;
    return c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
}

static void urldecode(char *s)
{
    char *r = s, *w = s;
    while (*r) {
        if (*r == '%' && hexval(r[1]) >= 0 && hexval(r[2]) >= 0) {
            *w++ = (char)((hexval(r[1]) << 4) | hexval(r[2]));
            r += 3;
        } else {
            *w++ = *r++;
        }
    }
    *w = 0;
}

static int parse_endpoint(const char *endpoint, struct route *r)
{
    char buf[1024], *rest, *at, *colon;

    if (!strcmp(endpoint, "direct://") || !strcmp(endpoint, "direct")) {
        r->s = DIRECT;
        return 0;
    }
    if (strlen(endpoint) >= sizeof(buf))
        return -1;

    strcpy(buf, endpoint);
    rest = strstr(buf, "://");
    if (!rest)
        return -1;
    *rest = 0;
    rest += 3;

    if (!strcmp(buf, "http"))
        r->s = HTTPP;
    else if (!strcmp(buf, "socks5") || !strcmp(buf, "socks5h"))
        r->s = SOCKS5;
    else
        return -1;

    r->auth = false;
    at = strrchr(rest, '@');
    if (at) {
        *at = 0;
        colon = strchr(rest, ':');
        if (colon) {
            *colon = 0;
            snprintf(r->user, sizeof(r->user), "%s", rest);
            snprintf(r->pass, sizeof(r->pass), "%s", colon + 1);
        } else {
            snprintf(r->user, sizeof(r->user), "%s", rest);
        }
        urldecode(r->user);
        urldecode(r->pass);
        r->auth = true;
        rest = at + 1;
    }

    return parse_hostport(rest, r->s == HTTPP ? 8080 : 1080,
                          r->host, sizeof(r->host), &r->port);
}

static int load_routes(struct route *routes)
{
    FILE *f = fopen(routes_file, "r");
    char *line = NULL, *p, *v[5];
    size_t cap = 0;
    ssize_t n;
    int count = 0;

    if (!f)
        return 0;

    while (count < MAX_ROUTES && (n = getline(&line, &cap, f)) > 0) {
        while (n && (line[n - 1] == '\n' || line[n - 1] == '\r'))
            line[--n] = 0;
        p = line;
        for (int i = 0; i < 5; i++)
            v[i] = strsep(&p, "|");
        if (!v[0] || !v[1] || !v[2])
            continue;
        memset(&routes[count], 0, sizeof(routes[count]));
        snprintf(routes[count].id, sizeof(routes[count].id), "%s", v[0]);
        snprintf(routes[count].label, sizeof(routes[count].label), "%s", v[1]);
        if (!parse_endpoint(v[2], &routes[count]))
            count++;
    }
    free(line);
    fclose(f);

    f = fopen(current_file, "r");
    if (f && count > 1) {
        char id[64] = {0};
        if (fgets(id, sizeof(id), f)) {
            p = strpbrk(id, "|\n");
            if (p) *p = 0;
            for (int i = 1; i < count; i++) {
                if (!strcmp(id, routes[i].id)) {
                    struct route tmp = routes[0];
                    routes[0] = routes[i];
                    routes[i] = tmp;
                    break;
                }
            }
        }
        fclose(f);
    } else if (f) {
        fclose(f);
    }
    return count;
}

static int set_nonblock(int fd, bool on)
{
    int flags = fcntl(fd, F_GETFL, 0);
    return flags < 0 ? -1 : fcntl(fd, F_SETFL, on ? flags | O_NONBLOCK : flags & ~O_NONBLOCK);
}

static int connect_tcp(const char *host, int port)
{
    char portstr[8];
    struct addrinfo hints = {0}, *addrs, *it;
    int fd = -1, err;
    socklen_t errlen = sizeof(err);

    snprintf(portstr, sizeof(portstr), "%d", port);
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_family = AF_UNSPEC;
    if (getaddrinfo(host, portstr, &hints, &addrs))
        return -1;

    for (it = addrs; it; it = it->ai_next) {
        fd = socket(it->ai_family, it->ai_socktype, it->ai_protocol);
        if (fd < 0)
            continue;
        set_nonblock(fd, true);
        if (connect(fd, it->ai_addr, it->ai_addrlen) < 0 && errno != EINPROGRESS) {
            close(fd);
            fd = -1;
            continue;
        }
        struct pollfd pfd = { fd, POLLOUT, 0 };
        if (poll(&pfd, 1, CONN_MS) <= 0 ||
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &errlen) < 0 || err) {
            close(fd);
            fd = -1;
            continue;
        }
        set_nonblock(fd, false);
        break;
    }
    freeaddrinfo(addrs);
    return fd;
}

static int write_all(int fd, const void *buf, size_t n)
{
    const char *p = buf;
    while (n) {
        ssize_t w = send(fd, p, n, MSG_NOSIGNAL);
        if (w < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (!w) return -1;
        p += w;
        n -= (size_t)w;
    }
    return 0;
}

static int read_all(int fd, void *buf, size_t n)
{
    char *p = buf;
    while (n) {
        ssize_t r = recv(fd, p, n, 0);
        if (r < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (!r) return -1;
        p += r;
        n -= (size_t)r;
    }
    return 0;
}

static int connect_socks5(struct route *r, const char *host, int port)
{
    int fd = connect_tcp(r->host, r->port);
    unsigned char buf[520], reply4[4], reply2[2];
    size_t n = 0;

    if (fd < 0) return -1;
    buf[n++] = 5;
    buf[n++] = r->auth ? 2 : 1;
    buf[n++] = 0;
    if (r->auth) buf[n++] = 2;
    if (write_all(fd, buf, n) || read_all(fd, reply2, 2) || reply2[0] != 5 || reply2[1] == 255)
        goto bad;

    if (reply2[1] == 2) {
        size_t u = strlen(r->user), p = strlen(r->pass);
        if (u > 255 || p > 255) goto bad;
        n = 0;
        buf[n++] = 1;
        buf[n++] = (unsigned char)u;
        memcpy(buf + n, r->user, u); n += u;
        buf[n++] = (unsigned char)p;
        memcpy(buf + n, r->pass, p); n += p;
        if (write_all(fd, buf, n) || read_all(fd, reply2, 2) || reply2[1])
            goto bad;
    } else if (reply2[1]) {
        goto bad;
    }

    size_t hlen = strlen(host);
    if (hlen > 255) goto bad;
    n = 0;
    buf[n++] = 5;
    buf[n++] = 1;
    buf[n++] = 0;
    buf[n++] = 3;
    buf[n++] = (unsigned char)hlen;
    memcpy(buf + n, host, hlen); n += hlen;
    buf[n++] = (unsigned char)(port >> 8);
    buf[n++] = (unsigned char)port;
    if (write_all(fd, buf, n) || read_all(fd, reply4, 4) || reply4[1])
        goto bad;

    size_t skip = reply4[3] == 1 ? 4 : reply4[3] == 4 ? 16 : 0;
    if (reply4[3] == 3) {
        unsigned char len;
        if (read_all(fd, &len, 1)) goto bad;
        skip = len;
    }
    if (!skip || read_all(fd, buf, skip + 2))
        goto bad;
    return fd;

bad:
    close(fd);
    return -1;
}

static const char base64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char *base64_encode(const char *s)
{
    size_t n = strlen(s), out_len = 4 * ((n + 2) / 3), i = 0, o = 0;
    char *out = malloc(out_len + 1);
    if (!out) return NULL;

    while (i < n) {
        uint32_t a = (unsigned char)s[i++];
        uint32_t b = i < n ? (unsigned char)s[i++] : 0;
        uint32_t c = i < n ? (unsigned char)s[i++] : 0;
        uint32_t v = a << 16 | b << 8 | c;
        out[o++] = base64_table[(v >> 18) & 63];
        out[o++] = base64_table[(v >> 12) & 63];
        out[o++] = base64_table[(v >> 6) & 63];
        out[o++] = base64_table[v & 63];
    }
    if (n % 3) {
        out[out_len - 1] = '=';
        if (n % 3 == 1) out[out_len - 2] = '=';
    }
    out[out_len] = 0;
    return out;
}

static int read_header(int fd, char **out, size_t *out_len)
{
    char *buf = malloc(HDR_MAX + 1);
    size_t n = 0;
    if (!buf) return -1;

    while (n < HDR_MAX) {
        ssize_t r = recv(fd, buf + n, HDR_MAX - n, 0);
        if (r <= 0) {
            free(buf);
            return -1;
        }
        n += (size_t)r;
        buf[n] = 0;
        if (strstr(buf, "\r\n\r\n")) {
            *out = buf;
            *out_len = n;
            return 0;
        }
    }
    free(buf);
    return -1;
}

static int connect_http_parent(struct route *r, const char *host, int port)
{
    int fd = connect_tcp(r->host, r->port);
    char auth[1024] = "", request[2048], *reply = NULL, *encoded = NULL;
    size_t reply_len;

    if (fd < 0) return -1;
    if (r->auth) {
        char credentials[600];
        snprintf(credentials, sizeof(credentials), "%s:%s", r->user, r->pass);
        encoded = base64_encode(credentials);
        if (!encoded) { close(fd); return -1; }
        snprintf(auth, sizeof(auth), "Proxy-Authorization: Basic %s\r\n", encoded);
        free(encoded);
    }

    int n = snprintf(request, sizeof(request),
                     "CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n%s\r\n",
                     host, port, host, port, auth);
    if (n < 0 || write_all(fd, request, (size_t)n) || read_header(fd, &reply, &reply_len))
        goto bad;

    int code = 0;
    sscanf(reply, "HTTP/%*s %d", &code);
    free(reply);
    if (code < 200 || code >= 300)
        goto bad_nofree;
    return fd;

bad:
    free(reply);
bad_nofree:
    close(fd);
    return -1;
}

static int parse_request(const char *header, struct req *req)
{
    const char *eol = strstr(header, "\r\n");
    char first[8192], target[4096];

    if (!eol || (size_t)(eol - header) >= sizeof(first))
        return -1;
    memcpy(first, header, (size_t)(eol - header));
    first[eol - header] = 0;
    memset(req, 0, sizeof(*req));

    if (sscanf(first, "%15s %4095s %15s", req->method, target, req->ver) != 3)
        return -1;

    if (!strcasecmp(req->method, "CONNECT")) {
        req->connect = true;
        return parse_hostport(target, 443, req->host, sizeof(req->host), &req->port);
    }

    if (!strncasecmp(target, "http://", 7)) {
        const char *authority = target + 7, *slash = strchr(authority, '/');
        char hostport[512];
        size_t n = slash ? (size_t)(slash - authority) : strlen(authority);
        if (!n || n >= sizeof(hostport)) return -1;
        memcpy(hostport, authority, n);
        hostport[n] = 0;
        if (parse_hostport(hostport, 80, req->host, sizeof(req->host), &req->port))
            return -1;
        snprintf(req->path, sizeof(req->path), "%s", slash ? slash : "/");
        return 0;
    }

    const char *p = header;
    while ((p = strstr(p, "\r\n"))) {
        p += 2;
        if (!strncasecmp(p, "Host:", 5)) {
            p += 5;
            while (*p == ' ' || *p == '\t') p++;
            eol = strstr(p, "\r\n");
            if (!eol) return -1;
            char hostport[512];
            size_t n = (size_t)(eol - p);
            if (n >= sizeof(hostport)) return -1;
            memcpy(hostport, p, n);
            hostport[n] = 0;
            if (parse_hostport(hostport, 80, req->host, sizeof(req->host), &req->port))
                return -1;
            snprintf(req->path, sizeof(req->path), "%s", target);
            return 0;
        }
    }
    return -1;
}

static int load_local_auth(const char *path)
{
    FILE *f;
    char line[768];

    local_auth = false;
    local_user[0] = local_pass[0] = 0;
    if (!path || !*path)
        return 0;

    f = fopen(path, "r");
    if (!f)
        return -1;

    while (fgets(line, sizeof(line), f)) {
        char *nl = strpbrk(line, "\r\n");
        if (nl) *nl = 0;
        if (!strncmp(line, "user=", 5)) {
            strncpy(local_user, line + 5, sizeof(local_user) - 1);
            local_user[sizeof(local_user) - 1] = 0;
        } else if (!strncmp(line, "pass=", 5)) {
            strncpy(local_pass, line + 5, sizeof(local_pass) - 1);
            local_pass[sizeof(local_pass) - 1] = 0;
        }
    }
    fclose(f);
    if (!local_user[0] || !local_pass[0])
        return -1;
    local_auth = true;
    return 0;
}

static bool local_auth_ok(const char *header)
{
    const char *p = header;
    char credentials[600], *expected;

    if (!local_auth)
        return true;

    snprintf(credentials, sizeof(credentials), "%s:%s", local_user, local_pass);
    expected = base64_encode(credentials);
    if (!expected)
        return false;

    while ((p = strstr(p, "\r\n"))) {
        p += 2;
        if (!strncasecmp(p, "Proxy-Authorization:", 20)) {
            p += 20;
            while (*p == ' ' || *p == '\t') p++;
            if (!strncasecmp(p, "Basic ", 6)) {
                p += 6;
                const char *eol = strstr(p, "\r\n");
                size_t n = eol ? (size_t)(eol - p) : strlen(p);
                bool ok = strlen(expected) == n && !strncmp(p, expected, n);
                free(expected);
                return ok;
            }
        }
    }
    free(expected);
    return false;
}

static void remember_route(struct route *r)
{
    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s.%ld", current_file, (long)getpid());
    FILE *f = fopen(tmp, "w");
    if (f) {
        fprintf(f, "%s|%s\n", r->id, r->label);
        fclose(f);
        rename(tmp, current_file);
    }
}

static void relay(int client, int upstream, struct traffic *traffic)
{
    struct pollfd fds[2] = {{client, POLLIN, 0}, {upstream, POLLIN, 0}};
    char buf[32768];

    for (;;) {
        if (poll(fds, 2, -1) < 0) {
            if (errno == EINTR) continue;
            return;
        }
        for (int i = 0; i < 2; i++) {
            if (fds[i].revents & (POLLIN | POLLERR | POLLHUP)) {
                ssize_t n = recv(fds[i].fd, buf, sizeof(buf), 0);
                if (n <= 0 || write_all(fds[1 - i].fd, buf, (size_t)n))
                    return;
                if (i == 0)
                    traffic->client_to_upstream += (uint64_t)n;
                else
                    traffic->upstream_to_client += (uint64_t)n;
            }
        }
    }
}

static int handle_client(int client)
{
    char *header = NULL, *end;
    size_t total_len, header_len;
    struct req req;
    struct route routes[MAX_ROUTES];
    struct traffic traffic = {0};
    int upstream = -1, chosen = -1;
    unsigned long long started = monotonic_ms();

    if (read_header(client, &header, &total_len) || parse_request(header, &req)) {
        free(header);
        return -1;
    }

    if (!local_auth_ok(header)) {
        const char *reply = "HTTP/1.1 407 Proxy Authentication Required\r\n"
                            "Proxy-Authenticate: Basic realm=\"hwelp\"\r\n"
                            "Connection: close\r\n\r\n";
        write_all(client, reply, strlen(reply));
        hlog(LOG_WARNING, "client authentication rejected");
        free(header);
        return -1;
    }

    end = strstr(header, "\r\n\r\n");
    header_len = (size_t)(end - header) + 4;

    int count = load_routes(routes);
    for (int i = 0; i < count; i++) {
        upstream = req.connect
            ? (routes[i].s == DIRECT ? connect_tcp(req.host, req.port)
               : routes[i].s == SOCKS5 ? connect_socks5(&routes[i], req.host, req.port)
               : connect_http_parent(&routes[i], req.host, req.port))
            : (routes[i].s == HTTPP ? connect_tcp(routes[i].host, routes[i].port)
               : routes[i].s == DIRECT ? connect_tcp(req.host, req.port)
               : connect_socks5(&routes[i], req.host, req.port));
        if (upstream >= 0) {
            chosen = i;
            break;
        }
    }

    if (upstream < 0) {
        const char *reply = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n";
        write_all(client, reply, strlen(reply));
        hlog(LOG_WARNING, "OpenWrt request to %s:%d failed: no usable upstream route (%d tried)",
             req.host, req.port, count);
        free(header);
        return -1;
    }

    remember_route(&routes[chosen]);

    if (req.connect) {
        const char *reply = "HTTP/1.1 200 Connection Established\r\nProxy-Agent: hwelp-proxy\r\n\r\n";
        if (write_all(client, reply, strlen(reply)))
            goto out;
    } else if (routes[chosen].s == HTTPP) {
        if (routes[chosen].auth) {
            char credentials[600], *encoded, *tmp;
            snprintf(credentials, sizeof(credentials), "%s:%s", routes[chosen].user, routes[chosen].pass);
            encoded = base64_encode(credentials);
            if (!encoded) goto out;
            tmp = malloc(header_len + strlen(encoded) + 64);
            if (!tmp) { free(encoded); goto out; }
            size_t prefix = (size_t)(end - header);
            memcpy(tmp, header, prefix);
            int n = snprintf(tmp + prefix, header_len + strlen(encoded) + 64 - prefix,
                             "\r\nProxy-Authorization: Basic %s\r\n\r\n", encoded);
            free(encoded);
            if (n < 0 || write_all(upstream, tmp, prefix + (size_t)n)) {
                free(tmp);
                goto out;
            }
            free(tmp);
        } else if (write_all(upstream, header, header_len)) {
            goto out;
        }
    } else {
        const char *eol = strstr(header, "\r\n");
        char first[8192];
        int n = snprintf(first, sizeof(first), "%s %s %s\r\n",
                         req.method, req.path[0] ? req.path : "/", req.ver);
        if (n < 0 || write_all(upstream, first, (size_t)n) ||
            write_all(upstream, eol + 2, header_len - (size_t)(eol + 2 - header)))
            goto out;
    }

    if (total_len > header_len) {
        size_t extra = total_len - header_len;
        if (write_all(upstream, header + header_len, extra))
            goto out;
        traffic.client_to_upstream += extra;
    }
    free(header);
    header = NULL;

    relay(client, upstream, &traffic);
    close(upstream);

    unsigned long long elapsed = monotonic_ms() - started;
    uint64_t sum = traffic.client_to_upstream + traffic.upstream_to_client;
    if (sum >= SESSION_LOG_MIN_BYTES || elapsed >= SESSION_LOG_MIN_MS || chosen > 0) {
        char up[32], down[32];
        human_bytes(traffic.client_to_upstream, up, sizeof(up));
        human_bytes(traffic.upstream_to_client, down, sizeof(down));
        hlog(LOG_INFO,
             "OpenWrt session %s:%d via %s [%s]: %.1fs, up %s, down %s%s",
             req.host, req.port, routes[chosen].label, scheme_name(routes[chosen].s),
             (double)elapsed / 1000.0, up, down, chosen > 0 ? " (fallback)" : "");
    }
    return 0;

out:
    free(header);
    close(upstream);
    return -1;
}

static int make_listener(bool check_only)
{
    if (strcmp(listen_host, "127.0.0.1") && strcmp(listen_host, "::1")) {
        errno = EACCES;
        return -1;
    }

    int af = strchr(listen_host, ':') ? AF_INET6 : AF_INET;
    int fd = socket(af, SOCK_STREAM, 0), one = 1, rc;
    if (fd < 0) return -1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    if (af == AF_INET) {
        struct sockaddr_in addr = {.sin_family=AF_INET, .sin_port=htons(listen_port)};
        inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
        rc = bind(fd, (void *)&addr, sizeof(addr));
    } else {
        struct sockaddr_in6 addr = {.sin6_family=AF_INET6, .sin6_port=htons(listen_port)};
        inet_pton(AF_INET6, "::1", &addr.sin6_addr);
        rc = bind(fd, (void *)&addr, sizeof(addr));
    }

    if (rc < 0) {
        close(fd);
        return -1;
    }
    if (!check_only && listen(fd, 64) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static int self_check(void)
{
    struct route r = {0};
    struct req q;
    char host[64];
    int port;

    if (parse_endpoint("socks5h://u:p%40s@127.0.0.1:1080", &r)) return 1;
    if (strcmp(r.pass, "p@s")) return 1;
    if (parse_request("CONNECT github.com:443 HTTP/1.1\r\n\r\n", &q)) return 1;
    if (parse_hostport("[::1]:1080", 80, host, sizeof(host), &port) || port != 1080) return 1;
    return 0;
}

int main(int argc, char **argv)
{
    bool check = false, check_bind = false;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-l") && i + 1 < argc)
            listen_host = argv[++i];
        else if (!strcmp(argv[i], "-p") && i + 1 < argc)
            listen_port = atoi(argv[++i]);
        else if (!strcmp(argv[i], "-c") && i + 1 < argc)
            routes_file = argv[++i];
        else if (!strcmp(argv[i], "-a") && i + 1 < argc)
            auth_file = argv[++i];
        else if (!strcmp(argv[i], "-L") && i + 1 < argc)
            activity_log_file = argv[++i];
        else if (!strcmp(argv[i], "--check"))
            check = true;
        else if (!strcmp(argv[i], "--check-bind"))
            check_bind = true;
        else if (!strcmp(argv[i], "--version")) {
            puts("hwelp-proxy " HWELP_VERSION);
            return 0;
        } else {
            return 2;
        }
    }

    if (listen_port < 1024 || listen_port > 65535)
        return 2;

    if (check) {
        int rc = self_check();
        if (!rc) puts("hwelp proxy: check ok");
        return rc;
    }

    if (auth_file && load_local_auth(auth_file)) {
        fprintf(stderr, "hwelp proxy: invalid auth file\n");
        return 2;
    }

    if (check_bind) {
        int fd = make_listener(true);
        if (fd < 0) {
            fprintf(stderr, "hwelp proxy: cannot bind %s:%d: %s\n",
                    listen_host, listen_port, strerror(errno));
            return errno == EADDRINUSE ? 3 : 1;
        }
        close(fd);
        return 0;
    }

    signal(SIGPIPE, SIG_IGN);
    signal(SIGCHLD, SIG_IGN);
    openlog("hwelp-proxy", LOG_PID, LOG_DAEMON);

    hlog(LOG_NOTICE, "ʕ•ᴥ•ʔ hwelp proxy starting on %s:%d; auth=%s",
         listen_host, listen_port, local_auth ? "on" : "off");

    int listener = make_listener(false);
    if (listener < 0) {
        hlog(LOG_ERR, "cannot bind %s:%d: %s", listen_host, listen_port, strerror(errno));
        closelog();
        return 1;
    }

    struct route startup_routes[MAX_ROUTES];
    int startup_count = load_routes(startup_routes);
    hlog(LOG_NOTICE, "ʕ•ᴥ•ʔ hwelp proxy ready to help; %d route%s available",
         startup_count, startup_count == 1 ? "" : "s");

    for (;;) {
        int client = accept(listener, NULL, NULL);
        if (client < 0) {
            if (errno == EINTR) continue;
            break;
        }
        pid_t pid = fork();
        if (!pid) {
            close(listener);
            handle_client(client);
            close(client);
            _exit(0);
        }
        close(client);
    }

    closelog();
    return 1;
}

'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Logs (TZ section 14, core)
 *
 * Shows the bot's syslog via `logread -e podkop-bot` with a selectable line
 * cap. The bot tags lines `podkop-bot` and never prints the token value, so
 * this is safe (TZ 2176). Support Bundle (14.3/14.4) is intentionally NOT built
 * here — the bot already produces a redacted bundle in its Telegram handler;
 * duplicating its redaction in LuCI would risk leaking the token (TZ 4.2).
 */

var callBotLogs = rpc.declare({ object:'podkop_bot', method:'bot_logs', params:['lines'] });


function pbFooter() {
	var callAppInfo = rpc.declare({ object: 'podkop_bot', method: 'app_info' });
	var span = E('span', {}, '');
	var box = E('div', { 'style': 'max-width:820px;margin-top:1.2em;padding-top:.6em;border-top:1px solid rgba(127,127,127,.15);color:#888;font-size:85%;text-align:right;' }, [ span ]);
	callAppInfo().then(function(a) {
		if (a && a.ok) {
			dom.content(span, [
				E('span', {}, 'luci-app-podkop-bot v' + (a.luci_app_version || '?') + ' \u00b7 '),
				E('a', { 'href': a.repo || 'https://github.com/Medvedolog/luci-app-podkop-bot', 'target': '_blank', 'rel': 'noopener' }, _('репозиторий'))
			]);
		}
	}).catch(function(){});
	return box;
}

return view.extend({
	curLines: 200,

	load: function() {
		return callBotLogs(200).catch(function(e){ return { ok:false, detail:String(e) }; });
	},

	render: function(data) {
		var self = this;

		var pre = E('pre', {
			'style':'max-height:60vh;overflow:auto;background:rgba(127,127,127,.08);' +
			        'padding:.7em;border-radius:6px;white-space:pre-wrap;font-size:85%;margin-top:.8em;'
		}, self.fmt(data));

		var statusSpan = E('span', { 'style':'margin-left:1em;color:#888;' }, self.statusText(data));

		function reload(n) {
			self.curLines = n;
			dom.content(pre, _('Загрузка…'));
			callBotLogs(n).then(function(d){
				dom.content(pre, self.fmt(d));
				dom.content(statusSpan, self.statusText(d));
				pre.scrollTop = pre.scrollHeight;
			}).catch(function(){
				dom.content(pre, _('Ошибка загрузки логов'));
			});
		}

		function limitBtn(n) {
			return E('button', {
				'class':'cbi-button' + (n === self.curLines ? ' cbi-button-action' : ''),
				'style':'margin-right:.3em;',
				'click': function(){ reload(n); }
			}, String(n));
		}

		var downloadBtn = E('button', {
			'class':'cbi-button',
			'style':'margin-left:.5em;',
			'click': function() {
				var txt = pre.textContent || '';
				var blob = new Blob([txt], { type:'text/plain' });
				var url = URL.createObjectURL(blob);
				var a = E('a', { 'href':url, 'download':'podkop-bot-log.txt' });
				document.body.appendChild(a); a.click();
				document.body.removeChild(a); URL.revokeObjectURL(url);
			}
		}, _('Скачать лог'));

		var refreshBtn = E('button', {
			'class':'cbi-button',
			'click': function(){ reload(self.curLines); }
		}, _('Обновить'));

		return E('div', {}, [
			E('h2', {}, _('Логи Podkop Bot')),
			E('p', { 'style':'color:#888;' }, [
				_('Системный лог бота (logread -e podkop-bot). Токен в логах не отображается.'),
				statusSpan
			]),
			E('div', { 'style':'margin-top:.5em;' }, [
				E('span', { 'style':'color:#888;margin-right:.5em;' }, _('Строк:')),
				limitBtn(50), limitBtn(100), limitBtn(200), limitBtn(500),
				refreshBtn, downloadBtn
			]),
			pre,
			E('p', { 'style':'color:#888;font-size:90%;margin-top:.6em;' },
				_('Support Bundle с маскировкой секретов собирается ботом в Telegram (Диагностика → Support Bundle).')),
			pbFooter()
		]);
	},

	fmt: function(d) {
		if (!d || d.ok === false) {
			if (d && d.reason === 'no_logread') return _('logread недоступен на этом устройстве.');
			return _('Логи недоступны') + (d && d.detail ? (': ' + d.detail) : '.');
		}
		var log = (d.log || '').trim();
		return log.length ? log : _('(нет строк podkop-bot в логе)');
	},

	statusText: function(d) {
		if (!d || d.ok === false) return '';
		var map = { running: _('служба работает'), stopped: _('служба остановлена'), unknown: '' };
		return map[d.init_status] || '';
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});

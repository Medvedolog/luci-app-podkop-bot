'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callStatus = rpc.declare({ object:'podkop_bot_bearhole', method:'status' });
var callResults = rpc.declare({ object:'podkop_bot_bearhole', method:'results' });
var callStart = rpc.declare({ object:'podkop_bot_bearhole', method:'start' });
var callSetEnabled = rpc.declare({ object:'podkop_bot_bearhole', method:'set_enabled', params:['enabled'] });
var callSetPort = rpc.declare({ object:'podkop_bot_bearhole', method:'set_port', params:['port'] });
var callSetProxy = rpc.declare({ object:'podkop_bot_bearhole', method:'set_proxy', params:['port','auth_enabled','username','password'] });
var callQualify = rpc.declare({ object:'podkop_bot_bearhole', method:'qualify_start' });
var callLog = rpc.declare({ object:'podkop_bot_bearhole', method:'log', params:['offset'] });

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:center;gap:.4em;min-width:0;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{'style':'overflow-wrap:anywhere;'},label)]);}
function lamp(c,title){return E('span',{'title':title||'','aria-label':title||'','style':'width:.72em;height:.72em;border-radius:50%;display:inline-block;vertical-align:middle;background:'+(COLOURS[c]||COLOURS.grey)+';'});}
function row(label,val){return E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},label),E('span',{'class':'pb-row-val'},[val])]);}
function card(title,children){return E('div',{'class':'cbi-section pb-card','style':'max-width:900px;'},[E('h3',{'style':'margin-top:0;'},title)].concat(children));}
function pbInjectCss(){if(document.getElementById('pb-css'))return;document.querySelector('head').appendChild(E('link',{'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')}));}
function age(ts){var n=parseInt(ts||0,10);if(!n)return '—';var s=Math.max(0,Math.floor(Date.now()/1000)-n);if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');}
function reasonText(r){var m={hwelp_missing:_('hwelp proxy пока не установлен. При запуске Bearhole будет попытка установить подходящий пакет автоматически.'),hwelp_broken:_('Установленный hwelp proxy не прошёл самопроверку.'),hwelp_install_failed:_('Не удалось установить hwelp proxy через доступные маршруты.'),package_manager_missing:_('Не найден поддерживаемый менеджер пакетов.'),port_in_use:_('Выбранный порт hwelp proxy уже занят.'),bad_port:_('Порт должен быть в диапазоне 1024–65535.'),port_save_failed:_('Не удалось сохранить порт hwelp proxy.'),proxy_save_failed:_('Не удалось сохранить настройки hwelp proxy.'),auth_invalid:_('Для авторизации нужны логин и пароль.'),gateway_start_failed:_('hwelp proxy не смог запуститься на выбранном порту.'),gateway_check_failed:_('hwelp proxy запустился, но контрольная загрузка через него не прошла.'),system_proxy_apply_failed:_('Не удалось включить системный прокси OpenWrt.'),qualification_start_failed:_('Не удалось запустить проверку цепочки маршрутов.'),no_routes:_('В цепочке нет маршрутов для проверки.'),no_usable_route:_('После проверки не найден рабочий маршрут для системных загрузок.'),route_check_timeout:_('Проверка маршрутов превысила допустимое время.'),uci_enable_failed:_('Не удалось сохранить настройку Bearhole.'),uci_commit_failed:_('Не удалось записать конфигурацию Bearhole.')};return m[r]||r||_('Неизвестная ошибка.');}
function verified(st){return !!(st.running&&st.system_applied&&st.state==='ready'&&st.reason==='gateway_verified');}
function stateNode(st){if(!st.enabled&&st.running)return dot('red',_('Рассинхронизация: Bearhole выключен, hwelp ещё запущен'));if(st.probing)return dot('yellow',_('Проверяю маршруты'));if(st.state==='verifying')return dot('yellow',_('Проверяю локальный шлюз'));if(st.starting)return dot('yellow',_('Запускается'));if(verified(st))return dot('green',_('Работает'));if(st.state==='failed')return dot('red',reasonText(st.reason));if(st.enabled&&!st.running)return dot('red',_('Шлюз не запущен'));return dot('grey',_('Выключен'));}
function hwelpNode(st){var pid=parseInt(st.pid||0,10)||0,s='';if(!st.hwelp_installed)return dot('grey',_('не установлен'));if(verified(st)){s=_('работает');if(pid>0)s+=' · PID '+String(pid);if(st.hwelp_version)s+=' · v'+st.hwelp_version;return dot('green',s);}if(st.running){s=(st.probing||st.state==='verifying'||st.starting)?_('запущен, проверяется'):_('запущен');if(pid>0)s+=' · PID '+String(pid);if(st.hwelp_version)s+=' · v'+st.hwelp_version;return dot('yellow',s);}if(st.starting)return dot('yellow',_('запускается'));if(st.engine_reason==='hwelp_broken')return dot('red',_('ошибка самопроверки'));return dot('grey',_('установлен, не запущен')+(st.hwelp_version?' · v'+st.hwelp_version:''));}
function q(v){if(v==='ok')return lamp('green',_('доступен'));if(v==='skip')return lamp('grey',_('не применимо'));return lamp('red',_('нет доступа'));}
function routeStatus(v){if(v==='VALID')return lamp('green',_('пригоден'));if(v==='DEGRADED')return lamp('yellow',_('частично пригоден'));return lamp('red',_('не пригоден'));}
function busy(st){return !!(st&&(st.starting||st.probing||st.state==='verifying'));}

return view.extend({
	load:function(){pbInjectCss();return Promise.all([callStatus().catch(function(){return {ok:false};}),callResults().catch(function(){return {items:[]};}),callLog(0).catch(function(){return {chunk:'',offset:0};})]);},

	render:function(data){
		this.status=data[0]||{};
		this.results=data[1]||{items:[]};
		this.logText=(data[2]&&data[2].chunk)||'';
		this.logOffset=(data[2]&&data[2].offset)||0;
		this.resourcesOpen=!busy(this.status)&&((this.results.items||[]).length>0);
		this.logOpen=false;
		this.proxyOpen=false;
		this.root=E('div',{});
		dom.content(this.root,this.renderBody());
		if(busy(this.status))this.schedulePoll(400);
		return this.root;
	},

	captureOpenState:function(){
		if(!this.root)return;
		var r=this.root.querySelector('#bearhole-service-checks'),l=this.root.querySelector('#bearhole-log'),p=this.root.querySelector('#bearhole-proxy-settings');
		if(r)this.resourcesOpen=!!r.open;
		if(l)this.logOpen=!!l.open;
		if(p)this.proxyOpen=!!p.open;
	},

	refresh:function(){
		var self=this,wasBusy=busy(this.status);
		this.captureOpenState();
		return Promise.all([callStatus(),callResults().catch(function(){return {items:[]};}),callLog(this.logOffset||0).catch(function(){return null;})]).then(function(x){
			self.status=x[0]||{};
			self.results=x[1]||{items:[]};
			if(x[2]){self.logOffset=x[2].offset||self.logOffset;if(x[2].chunk)self.logText+=x[2].chunk;}
			if(wasBusy&&!busy(self.status)&&(self.results.items||[]).length)self.resourcesOpen=true;
			dom.content(self.root,self.renderBody());
			return self.status;
		});
	},

	schedulePoll:function(ms){var self=this;if(this.timer)window.clearTimeout(this.timer);this.timer=window.setTimeout(function(){self.refresh().then(function(st){if(busy(st))self.schedulePoll(900);});},ms||900);},
	startBearhole:function(){var self=this;return callStart().then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'start_failed');self.status.starting=true;self.status.state='starting';dom.content(self.root,self.renderBody());self.schedulePoll(250);}).catch(function(e){ui.addNotification(null,E('p',{},_('Bearhole не запущен: ')+reasonText((e&&e.message)||'')),'error');return self.refresh();});},
	stopBearhole:function(){var self=this;return callSetEnabled(false).then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'disable_failed');return self.refresh();}).catch(function(e){ui.addNotification(null,E('p',{},_('Не удалось остановить Bearhole: ')+((e&&e.message)||'?')),'error');});},
	recheck:function(){var self=this;return callQualify().then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'check_failed');return self.refresh();}).then(function(){self.schedulePoll(300);}).catch(function(e){ui.addNotification(null,E('p',{},_('Не удалось запустить проверку маршрутов: ')+reasonText((e&&e.message)||'')),'error');});},

	saveProxy:function(portInput,authInput,userInput,passInput){
		var self=this,p=parseInt(portInput.value,10),auth=!!authInput.checked,user=(userInput.value||'').trim(),pass=passInput.value||'';
		if(!isFinite(p)||p<1024||p>65535){ui.addNotification(null,E('p',{},reasonText('bad_port')),'error');return;}
		if(auth&&!user){ui.addNotification(null,E('p',{},reasonText('auth_invalid')),'error');return;}
		if(auth&&!pass&&!this.status.auth_configured){ui.addNotification(null,E('p',{},reasonText('auth_invalid')),'error');return;}
		[portInput,authInput,userInput,passInput].forEach(function(x){x.disabled=true;});
		return callSetProxy(p,auth,user,pass).then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'proxy_save_failed');return self.refresh();}).then(function(st){if(st.starting)self.schedulePoll(250);}).catch(function(e){ui.addNotification(null,E('p',{},reasonText((e&&e.message)||'proxy_save_failed')),'error');return self.refresh();});
	},

	progressCard:function(st){if(!busy(st))return E('span',{});var done=parseInt(st.progress_done||0,10)||0,total=parseInt(st.progress_total||0,10)||0,label='';if(st.probing){label=_('Проверяю всю цепочку прокси');if(st.progress_label)label+=': '+st.progress_label;}else if(st.state==='verifying')label=_('Проверяю, что OpenWrt действительно выходит через hwelp proxy');else if(st.reason==='installing_hwelp')label=_('Устанавливаю hwelp proxy из owfeed');else if(st.reason==='system_proxy')label=_('Включаю системный прокси OpenWrt');else label=_('Подготавливаю цепочку и запускаю hwelp proxy');var kids=[E('strong',{},label)];if(st.probing&&total>0){kids.push(E('div',{'style':'margin-top:.55em;'},[E('progress',{'max':String(total),'value':String(Math.min(done,total)),'style':'width:100%;max-width:520px;'}),E('span',{'style':'margin-left:.6em;color:#888;'},String(done)+' / '+String(total))]));}return E('div',{'class':'cbi-section','style':'max-width:900px;margin-top:.7em;'},kids);},

	proxySettings:function(st,isBusy){
		var self=this;
		var port=E('input',{'type':'number','min':'1024','max':'65535','step':'1','value':String(st.port||1066),'disabled':isBusy?'disabled':null,'style':'width:7.5em;'});
		var auth=E('input',{'type':'checkbox','checked':st.auth_enabled?'checked':null,'disabled':isBusy?'disabled':null});
		var user=E('input',{'type':'text','value':st.auth_user||'','disabled':isBusy?'disabled':null,'autocomplete':'username','style':'max-width:18em;'});
		var pass=E('input',{'type':'password','value':'','placeholder':st.auth_configured?_('оставьте пустым, чтобы не менять'):_('пароль'),'disabled':isBusy?'disabled':null,'autocomplete':'new-password','style':'max-width:18em;'});
		var authFields=E('div',{'style':'display:'+(st.auth_enabled?'block':'none')+';margin-top:.5em;'},[row(_('Локальный логин'),user),row(_('Локальный пароль'),pass)]);
		auth.addEventListener('change',function(){authFields.style.display=auth.checked?'block':'none';});
		var localAuth=E('details',{'style':'margin:.7em 0;padding:.55em .7em;border:1px solid rgba(127,127,127,.16);border-radius:8px;'},[
			E('summary',{'style':'cursor:pointer;font-weight:600;'},_('Локальная авторизация hwelp (обычно не нужна)')),
			E('p',{'class':'pb-hint-90','style':'margin:.55em 0;'},_('Это защита ВХОДА в hwelp на 127.0.0.1. Она не относится к логину/паролю вышестоящего SOCKS/HTTP proxy. Так как hwelp слушает только loopback, обычно эту опцию можно оставить выключенной.')),
			row(_('Требовать авторизацию'),E('label',{'style':'display:inline-flex;align-items:center;gap:.45em;'},[auth,E('span',{},_('у программ самого OpenWrt'))])),authFields
		]);
		return E('details',{'id':'bearhole-proxy-settings','open':this.proxyOpen?'':null,'style':'margin:.7em 0 .3em;'},[
			E('summary',{'style':'cursor:pointer;font-weight:600;'},_('Настройки локального hwelp proxy')),
			E('div',{'style':'margin-top:.65em;max-width:720px;'},[
				row(_('Адрес входа'),E('code',{},'127.0.0.1')),
				row(_('Порт входа'),port),
				E('p',{'class':'pb-hint-90','style':'margin:.55em 0;'},_('Адрес намеренно фиксирован на loopback. Порт меняется только при конфликте.')),
				localAuth,
				E('div',{'style':'margin:.8em 0;padding:.65em .75em;border-left:3px solid #4d8fd8;background:rgba(77,143,216,.06);'},[
					E('strong',{},_('Авторизация на вышестоящих прокси')),
					E('div',{'class':'pb-hint-90','style':'margin-top:.35em;'},_('Логин и пароль SOCKS5/HTTP задаются в самой записи маршрута. hwelp получает их из общего registry и использует при подключении к upstream proxy.')),
					E('a',{'class':'cbi-button','style':'margin-top:.55em;','href':L.url('admin/services/podkop-bot/transport/main')},_('Открыть «Цепочку прокси»'))
				]),
				E('button',{'class':'cbi-button cbi-button-action','disabled':isBusy?'disabled':null,'click':function(){return self.saveProxy(port,auth,user,pass);}},_('Применить'))
			])
		]);
	},

	renderBody:function(){
		var st=this.status||{},items=(this.results&&this.results.items)||[],isBusy=busy(st),active=!!(st.enabled||st.running||isBusy),actions=[];
		if(!active){actions.push(E('button',{'class':'cbi-button cbi-button-action','click':ui.createHandlerFn(this,'startBearhole')},_('🐻 Запустить Bearhole')));}else{
			if(!isBusy&&st.engine_ready)actions.push(E('button',{'class':'cbi-button','click':ui.createHandlerFn(this,'recheck')},_('Проверить маршруты заново')));
			actions.push(E('button',{'class':'cbi-button cbi-button-negative','click':ui.createHandlerFn(this,'stopBearhole')},_('Остановить Bearhole')));
		}
		var engineWarn=E('span',{});if(!st.hwelp_installed)engineWarn=E('div',{'class':'alert-message warning','style':'margin:.7em 0;'},_('hwelp proxy не установлен. «🐻 Запустить Bearhole» сначала попробует установить нативный пакет из owfeed через доступную цепочку прокси.'));else if(!st.engine_ready)engineWarn=E('div',{'class':'alert-message warning','style':'margin:.7em 0;'},reasonText(st.engine_reason));
		var summary=(String(st.valid_routes||0)+' '+_('пригодных')+' · '+String(st.degraded_routes||0)+' '+_('частично пригодных'));
		var localProxy=E('span',{},[E('code',{},st.gateway||('http://127.0.0.1:'+(st.port||1066))),st.auth_enabled?E('span',{'style':'margin-left:.55em;'},dot('green',_('с авторизацией'))):E('span',{})]);
		var tunnelScope;
		if(st.system_applied&&st.running){
			var hooks=[];
			if(st.env_hook)hooks.push('shell / HTTP(S)_PROXY');
			if(st.curl_hook)hooks.push('curl');
			if(st.wget_hook)hooks.push('wget');
			if(st.opkg_hook)hooks.push('opkg');
			if(st.package_manager==='apk')hooks.push(_('apk — через HTTP(S)_PROXY окружения'));
			tunnelScope=E('div',{'style':'margin:.75em 0;padding:.72em .85em;border-left:3px solid #33a02c;background:rgba(51,160,44,.07);line-height:1.45;'},[
				E('strong',{},_('Нора включена. Системные загрузки OpenWrt идут через hwelp.')),
				E('div',{'style':'margin-top:.35em;'},[E('span',{},_('Путь: ')),E('code',{},st.gateway||('http://127.0.0.1:'+(st.port||1066))),E('span',{},' → '+(st.route_label||st.route_id||'—'))]),
				E('div',{'style':'margin-top:.3em;'},_('Подключено: ')+(hooks.length?hooks.join(' · '):_('системное HTTP(S)-окружение'))),
				E('div',{'class':'pb-hint-90','style':'margin-top:.25em;'},_('LAN-клиенты через Bearhole не идут. Дополнительно нору используют процессы и службы самого роутера, которые читают HTTP_PROXY / HTTPS_PROXY.'))
			]);
		}else if(!st.enabled&&st.running){
			tunnelScope=E('div',{'class':'alert-message warning','style':'margin:.75em 0;'},_('Обнаружен старый процесс hwelp при выключенном Bearhole. r51 автоматически приводит состояние к UCI при обновлении пакета.'));
		}else{
			tunnelScope=E('div',{'class':'pb-hint-90','style':'margin:.65em 0;'},_('Нора выключена: системные curl/wget/пакетные загрузки не направляются через Bearhole.'));
		}
		var statusCard=card(_('OpenWrt Bearhole'),[
			E('p',{'class':'pb-muted','style':'max-width:760px;'},_('Аварийный прокси для системных загрузок OpenWrt. Он выбирает рабочий маршрут из цепочки Podkop/Forkop, резервных прокси, WARP Rescue и Direct; LAN-трафик не затрагивается.')),
			engineWarn,
			row(_('Состояние Bearhole'),stateNode(st)),
			row(_('hwelp proxy'),hwelpNode(st)),
			row(_('Локальный прокси'),localProxy),
			row(_('Рабочий маршрут'),E('span',{},st.route_label||st.route_id||'—')),
			row(_('Проверка маршрутов'),E('span',{},summary)),
			row(_('Обновлено'),E('span',{},age(st.updated_at))),
			tunnelScope,
			this.proxySettings(st,isBusy),
			E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;margin-top:.8em;'},actions)
		]);
		var table=this.resultsTable(items);
		var details=E('details',{'id':'bearhole-service-checks','open':this.resourcesOpen?'':null,'style':'max-width:980px;margin-top:1em;'},[
			E('summary',{'style':'cursor:pointer;font-weight:600;'},_('Доступ к служебным ресурсам')),
			E('div',{'class':'pb-hint-90','style':'margin:.55em 0;line-height:1.45;'},_('GitHub, Raw, API, архивы и настроенные feeds OpenWrt. Цвет лампы показывает доступность через каждый маршрут; наведите на неё для расшифровки.')),
			E('div',{},[table])
		]);
		var log=E('details',{'id':'bearhole-log','open':this.logOpen?'':null,'style':'max-width:900px;margin-top:1em;'},[E('summary',{'style':'cursor:pointer;'},_('Журнал Bearhole')),E('pre',{'style':'max-height:320px;overflow:auto;white-space:pre-wrap;font-size:82%;'},this.logText||_('Лог пуст.'))]);
		return E('div',{},[E('h2',{},_('OpenWrt Bearhole')),statusCard,this.progressCard(st),details,log]);
	},

	resultsTable:function(items){
		if(!items.length)return E('p',{'class':'pb-hint-90'},_('Свежей проверки ещё нет. Нажмите «🐻 Запустить Bearhole» — при первом запуске он сам проверит всю цепочку.'));
		var narrow=!!(window.matchMedia&&window.matchMedia('(max-width: 720px)').matches);
		if(narrow){
			function res(label,val,title){return E('div',{'style':'display:flex;align-items:center;justify-content:space-between;gap:.45em;min-width:0;padding:.25em .35em;border-radius:6px;background:rgba(127,127,127,.06);'},[E('span',{'title':title||label,'style':'font-size:86%;white-space:nowrap;'},label),q(val)]);}
			return E('div',{},items.map(function(x){return E('div',{'style':'padding:.7em .15em;border-top:1px solid rgba(127,127,127,.16);'},[
				E('div',{'style':'display:flex;align-items:flex-start;justify-content:space-between;gap:.6em;'},[E('strong',{'style':'min-width:0;overflow-wrap:anywhere;'},x.label||x.id),routeStatus(x.status)]),
				E('div',{'class':'pb-hint-90','style':'font-family:monospace;overflow-wrap:anywhere;margin:.2em 0 .55em;'},x.endpoint||''),
				E('div',{'style':'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.35em;'},[
					res('GitHub',x.github_core,'github.com'),res('Raw',x.github_raw,'raw.githubusercontent.com'),res('API',x.github_api,'api.github.com'),
					res(_('Архив'),x.github_codeload,'codeload.github.com'),res('Feeds',x.openwrt_feeds,_('Репозитории OpenWrt'))
				]),
				E('div',{'class':'pb-hint-90','style':'text-align:right;margin-top:.45em;'},_('Проверено: ')+age(x.checked_at))
			]);}));
		}
		var rows=items.map(function(x){return E('tr',{},[
			E('td',{},[E('strong',{},x.label||x.id),E('div',{'class':'pb-hint-90','style':'overflow-wrap:anywhere;'},x.endpoint||'')]),
			E('td',{'style':'text-align:center;'},[routeStatus(x.status)]),E('td',{'style':'text-align:center;'},[q(x.github_core)]),E('td',{'style':'text-align:center;'},[q(x.github_raw)]),E('td',{'style':'text-align:center;'},[q(x.github_api)]),E('td',{'style':'text-align:center;'},[q(x.github_codeload)]),E('td',{'style':'text-align:center;'},[q(x.openwrt_feeds)]),E('td',{'style':'white-space:nowrap;text-align:center;'},age(x.checked_at))
		]);});
		function th(label,title){return E('th',{'title':title||label,'style':'white-space:nowrap;text-align:center;'},label);}
		return E('div',{'style':'overflow-x:auto;'},[E('table',{'class':'table','style':'min-width:760px;'},[
			E('thead',{},[E('tr',{},[E('th',{'style':'text-align:left;'},_('Маршрут')),th(_('Статус'),_('Итоговая пригодность маршрута')),th('GitHub',_('github.com')),th('Raw',_('raw.githubusercontent.com')),th('API',_('api.github.com')),th(_('Архив'),_('codeload.github.com')),th('Feeds',_('Репозитории OpenWrt')),E('th',{'style':'text-align:center;white-space:nowrap;'},_('Проверено'))])]),E('tbody',{},rows)
		])]);
	},

	handleSave:null,handleSaveApply:null,handleReset:null
});

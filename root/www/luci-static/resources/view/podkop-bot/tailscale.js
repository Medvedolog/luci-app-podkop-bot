'use strict';
'require view';
'require rpc';
'require dom';
'require ui';

var callStatus = rpc.declare({ object:'podkop_bot_tailscale', method:'status' });
var callCreate = rpc.declare({ object:'podkop_bot_tailscale', method:'create', params:['control_url','auth_key','hostname','accept_routes','advertise_exit_node','confirm_standalone'] });
var callSetEnabled = rpc.declare({ object:'podkop_bot_tailscale', method:'set_enabled', params:['enabled','confirm_standalone'] });
var callSetAccept = rpc.declare({ object:'podkop_bot_tailscale', method:'set_accept_routes', params:['enabled'] });
var callSetAdvertise = rpc.declare({ object:'podkop_bot_tailscale', method:'set_advertise_exit_node', params:['enabled'] });
var callReapply = rpc.declare({ object:'podkop_bot_tailscale', method:'reapply' });
var callDelete = rpc.declare({ object:'podkop_bot_tailscale', method:'delete', params:['purge_state'] });
var callRepairStatus = rpc.declare({ object:'podkop_bot_tsnet_repair', method:'status' });
var callRepairSet = rpc.declare({ object:'podkop_bot_tsnet_repair', method:'set_enabled', params:['enabled'] });

function row(k,v){return E('div',{'style':'display:grid;grid-template-columns:minmax(190px,34%) 1fr;gap:.7em;padding:.32em 0;'},[E('strong',{},k),E('span',{},[v])]);}
function yesno(v){return E('span',{'style':'font-weight:600;'},v?_('да'):_('нет'));}
function lamp(ok,label,bad){
	var color=ok?'#22c55e':(bad?'#ef4444':'#7b8794');
	return E('span',{'style':'display:inline-flex;align-items:center;gap:.42em;font-weight:600;white-space:nowrap;'},[
		E('span',{'style':'display:inline-block;width:.72em;height:.72em;border-radius:50%;background:'+color+';box-shadow:0 0 0 2px rgba(255,255,255,.06),0 0 7px '+color+';'}),
		label
	]);
}
function providerName(p){return ({'forkop-native':'Forkop (штатная интеграция)','forkop-x':'Forkop X (одноразовое применение)','podkop':'Podkop (одноразовое применение)'})[p]||p||'—';}
function errText(r){var m={provider_missing:_('Podkop/Forkop не найден'),tailscale_unsupported:_('этот sing-box не поддерживает Tailscale/tsnet'),already_configured:_('Tailscale уже настроен'),not_configured:_('Tailscale не настроен'),not_enabled:_('Tailscale выключен'),native_managed:_('штатная интеграция Forkop не требует ручного повторного применения'),unsupported_provider:_('автовосстановление нужно только для Podkop/Forkop X'),bad_value:_('некорректное значение'),bad_control_url:_('некорректный URL контрол-сервера'),bad_hostname:_('некорректное имя узла'),auth_key_required:_('нужен pre-auth key'),bad_auth_key:_('некорректный ключ'),bad_accept_routes_value:_('некорректное значение accept routes'),standalone_tailscale_running:_('уже работает standalone Tailscale/tailscaled'),uci_write_failed:_('не удалось сохранить UCI'),state_write_failed:_('не удалось сохранить состояние tsnet'),runtime_apply_failed:_('не удалось применить Tailscale к текущей конфигурации sing-box'),runtime_apply_not_visible:_('после применения endpoint не найден в текущей конфигурации sing-box'),restart_failed:_('не удалось применить native Forkop endpoint; изменение отменено'),disable_failed:_('не удалось безопасно выключить endpoint')};return m[r]||r||'?';}
function standaloneConfirm(){return confirm(_('На роутере уже работает отдельный Tailscale (tailscaled). Встроенный tsnet sing-box создаст второй самостоятельный узел. Продолжить?'));}
function runtimeLabel(st){
	var m={unconfigured:_('не настроен'),disabled:_('выключен'),ready:_('работает'),active:_('работает — сейчас есть Tailscale-трафик'),degraded:_('endpoint отсутствует в текущем конфиге'),failed:_('sing-box не работает')};
	if(st.runtime_state==='starting' && st.runtime_applied && st.singbox_running)
		return _('работает — endpoint запущен');
	return m[st.runtime_state]||st.runtime_state||_('неизвестно');
}
function runtimeHealthy(st){return !!(st.enabled&&st.singbox_running&&st.runtime_applied);}

return view.extend({
	load:function(){return Promise.all([callStatus().catch(function(){return {ok:false,rpc_error:true};}),callRepairStatus().catch(function(){return {ok:false,enabled:false,supported:false};})]);},
	render:function(data){var st=data[0]||{ok:false,rpc_error:true};this.repair=data[1]||{enabled:false,supported:false};this.root=E('div',{});dom.content(this.root,this.body(st));return this.root;},
	refresh:function(){var self=this;return Promise.all([callStatus(),callRepairStatus().catch(function(){return {enabled:false,supported:false};})]).then(function(data){self.repair=data[1]||{enabled:false,supported:false};dom.content(self.root,self.body(data[0]));});},
	standaloneCard:function(st){
		if(!st.standalone_tailscale_present)return null;
		return E('div',{'class':'cbi-section','style':'max-width:850px;'},[
			E('h3',{},_('Отдельный Tailscale')),
			row(_('Служба tailscaled'),lamp(!!st.standalone_tailscale_running,st.standalone_tailscale_running?_('работает'):_('остановлена'),false)),
			E('p',{'class':'description'},_('Это отдельный системный Tailscale, не встроенный tsnet sing-box. Он может существовать одновременно со встроенным узлом; это будут два независимых Tailscale-узла.'))
		]);
	},
	body:function(st){
		if(!st||st.rpc_error)return E('div',{},[E('h2',{},_('Tailscale')),E('div',{'class':'alert-message error'},_('Backend Tailscale недоступен.'))]);
		var head=[E('h2',{},_('Tailscale / tsnet')),E('div',{'class':'cbi-section','style':'max-width:850px;'},[E('p',{},_('Встроенное Tailscale-подключение работает внутри sing-box без отдельного tailscaled.')),E('p',{'class':'description'},_('Полный Forkop хранит endpoint штатно. Для Forkop X и Podkop приложение меняет только текущий runtime-конфиг sing-box. После перегенерации endpoint можно применить снова вручную или включить автовосстановление: cron раз в минуту проверяет состояние и вмешивается только после фактического восстановления Main/Backup Mixed Proxy. Постоянного watcher-процесса нет.'))])];
		if(st.provider&&st.provider!=='none')head.push(E('p',{'style':'max-width:850px;'},[E('strong',{},_('Интеграция: ')),providerName(st.provider)]));
		var standalone=this.standaloneCard(st);if(standalone)head.push(standalone);
		if(st.standalone_tailscale_running)head.push(E('div',{'class':'alert-message warning','style':'max-width:850px;'},_('Отдельный tailscaled уже работает. Включение встроенного tsnet создаст второй самостоятельный Tailscale-узел и потребует подтверждения.')));
		if(!st.provider||st.provider==='none'){head.push(E('div',{'class':'alert-message notice','style':'max-width:850px;'},_('Управляемая интеграция tsnet для этого варианта Podkop/Forkop недоступна. Существующий standalone Tailscale выше остаётся доступен только для наблюдения.')));return E('div',{},head);}
		if(!st.tailscale_supported){head.push(E('div',{'class':'alert-message warning','style':'max-width:850px;'},_('Установленный sing-box не поддерживает Tailscale.')));return E('div',{},head);}
		head.push(st.configured?this.statusCard(st):this.createCard(st));return E('div',{},head);
	},
	createCard:function(st){
		var self=this,status=E('div',{'style':'margin-top:.7em;'}),host=E('input',{'class':'cbi-input-text','type':'text','placeholder':'router-home','style':'width:100%;max-width:480px;'}),url=E('input',{'class':'cbi-input-text','type':'url','value':'https://controlplane.tailscale.com','style':'width:100%;max-width:620px;'}),key=E('input',{'class':'cbi-input-password','type':'password','autocomplete':'new-password','style':'width:100%;max-width:620px;'}),accept=E('input',{'type':'checkbox'}),adv=E('input',{'type':'checkbox'});
		function runCreate(confirmStandalone){btn.disabled=true;dom.content(status,E('em',{},_('Сохраняю узел…')));return callCreate(url.value,key.value,host.value,accept.checked,adv.checked,!!confirmStandalone).then(function(r){if(r&&r.reason==='standalone_tailscale_running'&&r.requires_confirmation){btn.disabled=false;if(!standaloneConfirm())return;return runCreate(true);}if(!r||!r.ok)throw new Error(errText(r&&r.reason));return self.refresh();}).catch(function(e){dom.content(status,E('span',{'style':'color:#b00;'},_('Ошибка: ')+(e.message||e)));btn.disabled=false;});}
		var btn=E('button',{'class':'cbi-button cbi-button-action','click':ui.createHandlerFn(this,function(){if(st&&st.standalone_tailscale_running){if(!standaloneConfirm())return;return runCreate(true);}return runCreate(false);})},_('Создать Tailscale-подключение'));
		return E('div',{'class':'cbi-section','style':'max-width:850px;'},[E('h3',{},_('Новое подключение')),E('p',{'class':'description'},_('Создаётся выключенным. После сохранения нажмите «Подключить к tailnet».')),row(_('Hostname'),host),row(_('Контрол-сервер'),url),row(_('Pre-auth key'),key),E('p',{'class':'description'},_('Ключ сохраняется локально с правами 0600 и не показывается в LuCI.')),E('label',{},[accept,' ',_('Принимать маршруты, объявленные другими узлами tailnet')]),E('br'),E('label',{},[adv,' ',_('Анонсировать этот роутер как exit node')]),E('div',{'style':'margin-top:1em;'},[btn]),status]);
	},
	statusCard:function(st){
		var self=this,status=E('div',{'style':'margin-top:.8em;'}),purge=E('input',{'type':'checkbox'}),repair=this.repair||{enabled:false,supported:false};
		function setPower(enable,confirmStandalone){power.disabled=true;return callSetEnabled(enable,!!confirmStandalone).then(function(r){if(r&&r.reason==='standalone_tailscale_running'&&r.requires_confirmation){power.disabled=false;if(!standaloneConfirm())return;return setPower(enable,true);}if(!r||!r.ok)throw new Error(errText(r&&r.reason));return self.refresh();}).catch(function(e){dom.content(status,E('span',{'style':'color:#b00;'},_('Ошибка: ')+(e.message||e)));power.disabled=false;});}
		function setOpt(call,value){return call(value).then(function(r){if(!r||!r.ok)throw new Error(errText(r&&r.reason));return self.refresh();}).catch(function(e){dom.content(status,E('span',{'style':'color:#b00;'},_('Ошибка: ')+(e.message||e)));});}
		var power=E('button',{'class':'cbi-button '+(st.enabled?'cbi-button-negative':'cbi-button-positive'),'click':ui.createHandlerFn(this,function(){var enable=!st.enabled;if(enable&&st.standalone_tailscale_running){if(!standaloneConfirm())return;return setPower(true,true);}return setPower(enable,false);})},st.enabled?_('Отключить Tailscale'):_('Подключить к tailnet'));
		var acceptBtn=E('button',{'class':'cbi-button','click':ui.createHandlerFn(this,function(){return setOpt(callSetAccept,!st.accept_routes);})},st.accept_routes?_('Не принимать маршруты'):_('Принимать маршруты'));
		var advBtn=E('button',{'class':'cbi-button','click':ui.createHandlerFn(this,function(){return setOpt(callSetAdvertise,!st.advertise_exit_node);})},st.advertise_exit_node?_('Не быть exit node'):_('Анонсировать exit node'));
		var reapplyBtn=null,recovery=null;
		if(st.integration==='runtime'&&st.enabled&&!st.runtime_applied){
			reapplyBtn=E('button',{'class':'cbi-button cbi-button-action','click':ui.createHandlerFn(this,function(){reapplyBtn.disabled=true;dom.content(status,E('em',{},_('Применяю endpoint к текущей конфигурации sing-box…')));return callReapply().then(function(r){if(!r||!r.ok)throw new Error(errText(r&&r.reason));return self.refresh();}).catch(function(e){dom.content(status,E('span',{'style':'color:#b00;'},_('Ошибка: ')+(e.message||e)));reapplyBtn.disabled=false;});})},_('Применить заново'));
			recovery=E('div',{'class':'alert-message warning','style':'margin:.8em 0;'},[E('div',{},_('Tailscale настроен и включён, но endpoint отсутствует в текущей конфигурации sing-box. Вероятно, Podkop/Forkop пересоздал runtime-конфиг.')),E('div',{'style':'margin-top:.7em;'},[reapplyBtn])]);
		}
		var autoRepair=null;
		if(st.integration==='runtime'&&repair.supported){
			var autoCb=E('input',{'type':'checkbox','checked':repair.enabled?'checked':null,'change':ui.createHandlerFn(this,function(){autoCb.disabled=true;return callRepairSet(!!autoCb.checked).then(function(r){if(!r||!r.ok)throw new Error(errText(r&&r.reason));return self.refresh();}).catch(function(e){autoCb.checked=!autoCb.checked;autoCb.disabled=false;dom.content(status,E('span',{'style':'color:#b00;'},_('Ошибка: ')+(e.message||e)));});})});
			autoRepair=E('div',{'style':'margin:.9em 0 1em;padding:.8em 1em;border:1px solid rgba(127,127,127,.25);border-radius:8px;'},[E('label',{'style':'display:flex;gap:.55em;align-items:flex-start;'},[autoCb,E('span',{},[E('strong',{},_('Автовосстановление после перегенерации Forkop/Podkop')),E('div',{'class':'description','style':'margin-top:.25em;'},_('Раз в минуту cron проверяет, не исчез ли endpoint. Повторное применение разрешается только когда Forkop не держит reload-lock и Main либо Backup Mixed Proxy реально проводит трафик. После попытки действует пауза 5 минут.'))])])]);
		}
		var del=E('button',{'class':'cbi-button cbi-button-negative','click':ui.createHandlerFn(this,function(){if(!confirm(_('Удалить встроенное Tailscale-подключение? Настройки Forkop X / Podkop и остальные прокси не изменятся.')))return;del.disabled=true;return callDelete(purge.checked).then(function(r){if(!r||!r.ok)throw new Error(errText(r&&r.reason));return self.refresh();}).catch(function(e){dom.content(status,E('span',{'style':'color:#b00;'},_('Ошибка: ')+(e.message||e)));del.disabled=false;});})},_('Удалить подключение'));
		var auth=st.auth_url?E('a',{'href':st.auth_url,'target':'_blank','rel':'noreferrer noopener'},_('Открыть авторизацию')):E('span',{},'—');
		var stateLamp=lamp(runtimeHealthy(st),runtimeLabel(st),st.runtime_state==='degraded'||st.runtime_state==='failed');
		return E('div',{'class':'cbi-section','style':'max-width:850px;'},[E('h3',{},_('Узел Tailscale')),row(_('Состояние'),stateLamp),row(_('Hostname'),E('code',{},st.hostname||'—')),row(_('Контрол-сервер'),E('code',{},st.control_url||'—')),row(_('Принимать маршруты'),yesno(!!st.accept_routes)),row(_('Анонсировать exit node'),yesno(!!st.advertise_exit_node)),row(_('URL авторизации'),auth),recovery,E('div',{'style':'margin:.8em 0 1.1em;display:flex;gap:.6em;flex-wrap:wrap;'},[power,acceptBtn,advBtn]),autoRepair,E('hr'),E('h4',{},_('Удаление')),E('p',{'class':'description'},_('Удалит встроенное Tailscale-подключение из текущей конфигурации sing-box. Настройки Forkop X / Podkop и остальные прокси не изменяются. По умолчанию локальное состояние узла сохраняется, поэтому при повторной настройке роутер сможет вернуться как тот же Tailscale-узел.')),E('label',{},[purge,' ',_('Также забыть этот Tailscale-узел на роутере. При следующем подключении будет создан новый локальный узел.')]),E('div',{'style':'margin-top:.8em;'},[del]),status]);
	}
});
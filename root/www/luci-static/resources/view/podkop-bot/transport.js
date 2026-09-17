'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callState   = rpc.declare({ object:'podkop_bot', method:'transport_state' });
var callProbe   = rpc.declare({ object:'podkop_bot', method:'transport_probe', params:['target'] });
var callEnsureMP = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy' });
var callSetPolicy = rpc.declare({ object:'podkop_bot', method:'set_transport_policy', params:['policy'] });
var callFbCrud = rpc.declare({ object:'podkop_bot', method:'fallback_crud', params:['op','value','index'] });
var callListIfaces = rpc.declare({ object:'podkop_bot', method:'list_interfaces' });
var callSetField = rpc.declare({ object:'podkop_bot', method:'set_uci_field', params:['field','value'] });
var callSetTier1Port = rpc.declare({ object:'podkop_bot', method:'set_tier1_port', params:['value','section'] });
var callRuntimeSections = rpc.declare({ object:'podkop_bot', method:'runtime_sections' });
var callWarpStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });
var callBearStatus = rpc.declare({ object:'podkop_bot_bearhole', method:'status' });
var callBearResults = rpc.declare({ object:'podkop_bot_bearhole', method:'results' });
var callBearSetEnabled = rpc.declare({ object:'podkop_bot_bearhole', method:'set_enabled', params:['enabled'] });
var callBearQualify = rpc.declare({ object:'podkop_bot_bearhole', method:'qualify_start' });
var callBearRefresh = rpc.declare({ object:'podkop_bot_bearhole', method:'refresh_routes' });

var _CHAIN_STORE_KEY = 'podkop-bot.transport-chain-cache.v1';
var _chainTestedThisSession = false;
var _chainCache = {};
var _chainCheckedAt = 0;

function loadChainProbeCache() {
	try {
		var raw = window.sessionStorage ? sessionStorage.getItem(_CHAIN_STORE_KEY) : null;
		if (!raw) return;
		var v = JSON.parse(raw);
		if (!v || typeof v !== 'object') return;
		_chainCheckedAt = parseInt(v.checked_at || 0, 10) || 0;
		_chainCache = (v.cache && typeof v.cache === 'object') ? v.cache : {};
		_chainTestedThisSession = !!_chainCheckedAt;
	} catch (e) {
		_chainCheckedAt = 0; _chainCache = {}; _chainTestedThisSession = false;
	}
}
function saveChainProbeCache() {
	try {
		if (!window.sessionStorage) return;
		sessionStorage.setItem(_CHAIN_STORE_KEY, JSON.stringify({ checked_at:_chainCheckedAt, cache:_chainCache }));
	} catch (e) {}
}
loadChainProbeCache();

function fbEndpoint(s) { return String(s || '').split('#')[0]; }
function fbMnemonic(s) { var i = String(s || '').indexOf('#'); return i < 0 ? '' : String(s).slice(i + 1); }
function fbMask(s) { return String(s || '').replace(/(:\/\/[^:@/]+:)[^@/]*@/, '$1***@'); }
function sectionRouteId(name) {
	var s=String(name||'route').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');
	return 'section_' + (s || 'route');
}
function chainKey(t) {
	var ep = (t.id === 'tier4') ? 'direct' : fbEndpoint(t.endpoint || '');
	return t.id + '|' + ep;
}
function clearChainProbeCache() {
	_chainCache = {}; _chainCheckedAt = 0; _chainTestedThisSession = false;
	try { if (window.sessionStorage) sessionStorage.removeItem(_CHAIN_STORE_KEY); } catch (e) {}
}
function fbParse(s) {
	var out = { scheme:'socks5h', user:'', pass:'', host:'', port:'', mnemonic:'' };
	var raw = String(s || '').trim(); if (!raw) return out;
	out.mnemonic = fbMnemonic(raw);
	var ep = fbEndpoint(raw), m = ep.match(/^([a-z0-9]+):\/\/(.*)$/i); if (!m) return out;
	out.scheme = m[1].toLowerCase(); var rest = m[2], at = rest.lastIndexOf('@');
	if (at >= 0) { var creds=rest.slice(0,at); rest=rest.slice(at+1); var ci=creds.indexOf(':'); if(ci>=0){out.user=creds.slice(0,ci);out.pass=creds.slice(ci+1);}else out.user=creds; }
	var pc=rest.lastIndexOf(':'); if(pc>=0){out.host=rest.slice(0,pc);out.port=rest.slice(pc+1);}else out.host=rest;
	return out;
}
function fbBuild(f) { var auth=f.user?(f.user+(f.pass?':'+f.pass:'')+'@'):''; var mn=f.mnemonic?('#'+f.mnemonic):''; return f.scheme+'://'+auth+f.host+':'+f.port+mn; }
function fbDisplay(s) { var m=fbMnemonic(s), ep=fbMask(fbEndpoint(s)); return m?(m+' — '+ep):ep; }

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}
function pbInjectCss(){if(document.getElementById('pb-css'))return;document.querySelector('head').appendChild(E('link',{'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')}));}
function pbFooter(){var callAppInfo=rpc.declare({object:'podkop_bot',method:'app_info'}),span=E('span',{},''),box=E('div',{'style':'max-width:820px;margin-top:1.2em;padding-top:.6em;border-top:1px solid rgba(127,127,127,.15);color:#888;font-size:85%;text-align:right;'},[span]);callAppInfo().then(function(a){if(a&&a.ok)dom.content(span,[E('span',{},'luci-app-podkop-bot v'+(a.luci_app_version||'?')+' · '),E('a',{'href':a.repo||'https://github.com/Medvedolog/luci-app-podkop-bot','target':'_blank','rel':'noopener'},_('репозиторий'))]);}).catch(function(){});return box;}
function bearStateNode(st){if(st&&st.running&&st.state==='ready')return dot('green',_('Готов'));if(st&&st.probing)return dot('yellow',_('Проверка SYSTEM'));if(st&&st.enabled&&!st.running)return dot('red',_('Включён, но шлюз не запущен'));if(st&&st.state==='degraded')return dot('yellow',_('Нет SYSTEM VALID маршрута'));return dot(st&&st.enabled?'yellow':'grey',st&&st.enabled?_('Ожидание'):_('Выключен'));}
function bearRouteBadge(item){if(!item)return E('span',{});var c=item.status==='VALID'?'green':(item.status==='DEGRADED'?'yellow':'red');return E('span',{'style':'margin-left:.35em;font-size:82%;'},[dot(c,'SYSTEM '+(item.status||'?'))]);}

return view.extend({
	load:function(){
		pbInjectCss();
		return Promise.all([
			callState().catch(function(e){return {ok:false,detail:String(e)};}),
			callRuntimeSections().catch(function(){return null;}),
			callWarpStatus('').catch(function(){return null;}),
			callRescueStatus().catch(function(){return null;}),
			callBearStatus().catch(function(){return {ok:false,enabled:false};}),
			callBearResults().catch(function(){return {items:[]};})
		]);
	},
	render:function(data){
		var self=this;
		this.state=data[0]; this.sectionsData=data[1]; this.warpStatus=data[2]; this.rescueStatus=data[3];
		this.bearStatus=data[4]||{ok:false,enabled:false}; this.bearResults=data[5]||{items:[]};
		var d=this.state;
		if(!d||d.ok===false||d.available===false)return E('div',{},[E('h2',{},_('Цепочка прокси')),E('div',{'class':'cbi-section'},dot('grey',_('Состояние транспорта недоступно')))]);
		this.tiers=this.buildTiers(d);
		this.chainBox=E('div',{'id':'podkop-tiers'},this.renderTiers(this.tiers,d));
		this.bearholeBox=E('div',{},[this.bearholeCard()]);
		var addBtn=E('button',{'class':'cbi-button cbi-button-add','click':ui.createHandlerFn(this,function(){return self.fbForm(-1,'');})},_('Добавить резервный прокси'));
		var testAllBtn=E('button',{'class':'cbi-button cbi-button-action','click':ui.createHandlerFn(this,'testFullChain')},_('Проверить всю цепочку')); this._testAllBtn=testAllBtn;
		var reloadBtn=E('button',{'class':'cbi-button','click':ui.createHandlerFn(this,function(){return self.refreshState();})},_('Перечитать состояние'));
		var actionRow=E('div',{'class':'pb-action-row','style':'margin:.7em 0 .3em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;'},[addBtn,testAllBtn,reloadBtn]);
		var actionHint=E('div',{'class':'pb-hint-90','style':'margin-bottom:.8em;line-height:1.55;'},[
			E('div',{},[E('strong',{},_('Проверить всю цепочку')),': ',_('проверяет Telegram через каждый доступный маршрут сверху вниз и обновляет статус и задержку.')]),
			E('div',{},[E('strong',{},_('Перечитать состояние')),': ',_('не проверяет сеть, а только заново читает текущую конфигурацию и состояние бота, Podkop/Forkop и WARP.')])
		]);
		this._chainMeta=E('div',{'style':'margin:.4em 0 .6em;color:#888;font-size:85%;'});
		/* Opening the page must be side-effect free: show the last cached result,
		 * but never start Telegram probes without an explicit button click. */
		window.setTimeout(function(){self.applyChainCache();},60);
		if(this.bearStatus&&this.bearStatus.probing)window.setTimeout(function(){self.refreshBearhole(true);},500);
		return E('div',{},[
			E('h2',{},_('Цепочка прокси')),
			E('p',{'class':'pb-muted'},_('Здесь показано, как бот подключается к api.telegram.org, если прямой доступ заблокирован.')),
			E('p',{'class':'pb-muted','style':'margin-top:-.5em;'},_('Автоопределённые секции Podkop/Forkop и настроенный WARP Rescue входят в эту же цепочку. Активный путь подсвечен.')),
			this.botTransportCard(d),
			this.bearholeBox,
			E('div',{'class':'cbi-section pb-card'},[E('h3',{'style':'margin-top:0;'},_('Цепочка маршрутов')),actionRow,actionHint,this._chainMeta,this.chainBox,this.addFbRow()]),
			pbFooter()
		]);
	},

	bearResultFor:function(id){
		var rid=id==='tier4'?'direct':id,items=(this.bearResults&&this.bearResults.items)||[];
		for(var i=0;i<items.length;i++)if(items[i]&&items[i].id===rid)return items[i];
		return null;
	},

	bearholeCard:function(){
		var self=this,st=this.bearStatus||{},enabled=!!st.enabled;
		var toggle=E('input',{'type':'checkbox','checked':enabled?'checked':null,'change':ui.createHandlerFn(this,function(ev){
			var on=!!ev.target.checked;ev.target.disabled=true;
			return callBearSetEnabled(on).then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'failed');return self.refreshBearhole(true);}).catch(function(e){ui.addNotification(null,E('p',{},_('Не удалось изменить OpenWrt Bearhole: ')+(e&&e.message||'?')),'error');}).finally(function(){ev.target.disabled=false;});
		})});
		var test=E('button',{'class':'cbi-button cbi-button-action','disabled':st.probing?'disabled':null,'click':ui.createHandlerFn(this,function(){test.disabled=true;return callBearQualify().then(function(){return self.refreshBearhole(true);}).finally(function(){test.disabled=false;});})},st.probing?_('SYSTEM проверяется…'):_('Проверить SYSTEM'));
		var reread=E('button',{'class':'cbi-button','click':ui.createHandlerFn(this,function(){return callBearRefresh().then(function(){return self.refreshBearhole(true);});})},_('Перечитать маршруты'));
		var details=E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/transport/bearhole')},_('Подробная диагностика'));
		var cur=st.route_label||st.route_id||'—';
		return E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[
			E('h3',{'style':'margin-top:0;'},_('OpenWrt Bearhole')),
			E('p',{'class':'pb-muted'},_('Аварийный системный прокси OpenWrt. Использует эту же цепочку маршрутов, но допускает в системные загрузки только маршруты с профилем SYSTEM VALID. LAN и правила Podkop/Forkop не изменяются.')),
			this.row(_('Системный прокси'),toggle),
			this.row(_('Состояние'),bearStateNode(st)),
			this.row(_('Шлюз'),E('code',{},st.gateway||'http://127.0.0.1:1066')),
			this.row(_('Текущий SYSTEM-маршрут'),E('span',{},cur)),
			this.row(_('Квалификация'),E('span',{},String(st.valid_routes||0)+' VALID · '+String(st.degraded_routes||0)+' DEGRADED')),
			E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;margin-top:.7em;'},[test,reread,details])
		]);
	},

	refreshBearhole:function(poll){
		var self=this;
		return Promise.all([callBearStatus().catch(function(){return self.bearStatus||{};}),callBearResults().catch(function(){return self.bearResults||{items:[]};})]).then(function(res){
			self.bearStatus=res[0]||{};self.bearResults=res[1]||{items:[]};
			if(self.bearholeBox)dom.content(self.bearholeBox,[self.bearholeCard()]);
			if(self.chainBox&&self.state){self.tiers=self.buildTiers(self.state);dom.content(self.chainBox,self.renderTiers(self.tiers,self.state));window.setTimeout(function(){self.applyChainCache();},20);}
			if(poll&&self.bearStatus.probing)self.scheduleBearholePoll();
			return self.bearStatus;
		});
	},

	scheduleBearholePoll:function(){
		var self=this;if(this._bearTimer)window.clearTimeout(this._bearTimer);
		this._bearTimer=window.setTimeout(function(){self.refreshBearhole(true);},1400);
	},

	botTransportCard:function(d){
		var pollKey=d.poll_route||d.route||'unknown',pollName=d.poll_route_name||d.route_name||pollKey,fastKey=d.fast_route||'unknown',fastName=d.fast_route_name||fastKey;
		var routeLabel=(pollName&&pollName!=='unknown'&&pollName!==pollKey)?(pollName+' ['+pollKey+']'):pollKey;
		var fastLabel=(fastName&&fastName!=='unknown'&&fastName!==fastKey)?(fastName+' ['+fastKey+']'):fastKey;
		var routeColour=(pollKey==='fail')?'red':((pollKey==='tier4'||pollKey==='tier5')?'yellow':(pollKey!=='unknown'?'green':'grey'));
		var fastColour=(fastKey==='fail')?'red':((fastKey==='tier4'||fastKey==='tier5')?'yellow':(fastKey!=='unknown'?'green':'grey'));
		var directColour=(d.tg_direct==='ok')?'green':(d.tg_direct==='fail'?'yellow':'grey');
		var transportColour=(d.tg_transport==='ok')?'green':(d.tg_transport==='fail'?'red':'grey');
		var sel=E('select',{'class':'cbi-input-select','style':'padding:.15em .4em;font-size:90%;height:auto;line-height:1.3;max-width:100%;min-width:0;'},[E('option',{'value':'auto'},_('Авто (напрямую → SOCKS)')),E('option',{'value':'socks'},_('Только SOCKS')),E('option',{'value':'direct'},_('Только напрямую'))]);sel.value=d.policy||'auto';
		var policyStatus=E('span',{'style':'margin-left:.5em;color:#888;font-size:85%;'}),warnNode=E('div',{'style':'color:#e8a33d;margin:.2em 0 0;font-size:85%;'});
		function updateWarn(){warnNode.textContent=(sel.value==='socks'||sel.value==='direct')?_('Принудительный режим может отключить бота в условиях блокировок.'):'';}sel.addEventListener('change',updateWarn);updateWarn();
		var saveBtn=E('button',{'class':'cbi-button cbi-button-apply','style':'padding:.15em .6em;font-size:90%;','click':ui.createHandlerFn(this,function(){dom.content(policyStatus,_('сохранение и перезапуск…'));return callSetPolicy(sel.value).then(function(r){dom.content(policyStatus,r&&r.ok?(_('сохранено · ')+(r.service_running?_('бот работает'):_('бот остановлен'))):_('ошибка'));}).catch(function(){dom.content(policyStatus,_('ошибка вызова'));});})},_('Сохранить и перезапустить бота'));
		return E('div',{'class':'cbi-section','style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));'},[
			E('h3',{'style':'margin-top:0;'},_('Состояние')),this.row(_('Приём команд (POLL)'),dot(routeColour,routeLabel)),this.row(_('Отправка сообщений (FAST)'),dot(fastColour,fastLabel)),this.row(_('Telegram напрямую'),dot(directColour,d.tg_direct==='fail'?_('заблокирован (ожидаемо)'):(d.tg_direct||'unknown'))),this.row(_('Telegram через резервный транспорт'),dot(transportColour,d.tg_transport||'unknown')),
			E('div',{'style':'display:flex;align-items:center;padding:.3em 0;gap:.5em;flex-wrap:wrap;'},[E('span',{'style':'color:#888;flex:none;'},_('Режим транспорта')),E('span',{'style':'display:flex;align-items:center;gap:.4em;flex-wrap:wrap;'},[sel,saveBtn,policyStatus])]),warnNode
		]);
	},

	buildTiers:function(d){
		var t=[],t1=d.tier1||{};
		t.push({id:'tier1',name:_('Podkop SOCKS5 / Mixed Proxy (tier1)'),configured:!!t1.mixed_proxy_enabled,endpoint:t1.endpoint||'',note:t1.mixed_proxy_enabled?(t1.section?(_('секция ')+t1.section):''):_('Mixed Proxy выключен')});

		var sd=this.sectionsData||{},primary=sd.primary_section||'';
		(sd.sections||[]).forEach(function(s){
			if(!s||s.name===primary||!s.enabled_for_runtime||!s.endpoint)return;
			var id=sectionRouteId(s.name);
			t.push({id:id,name:'Podkop: '+s.name+' ['+id+']',configured:true,endpoint:s.endpoint,note:_('определён автоматически · только чтение'),_section:true});
		});

		(d.tier2_fallback_socks||[]).forEach(function(fb,i){t.push({id:'tier2_'+(i+1),name:_('Резервный прокси')+' #'+(i+1)+' (tier2.'+(i+1)+')',configured:true,endpoint:fb,note:'',_fbIndex:i});});
		t.push({id:'tier3',name:_('Свой прокси (tier3)'),configured:!!(d.tier3_custom_proxy&&d.tier3_custom_proxy.length),endpoint:d.tier3_custom_proxy||'',note:d.tier3_custom_proxy?'':_('не задан')});

		var ws=this.warpStatus||{},wc=ws.config||{},rs=this.rescueStatus||{};
		if(ws.installed&&ws.account_ready&&wc.enabled){
			var parts=[_('настроен'),String(ws.shortlist_count||0)+' '+_('кандидатов')];
			if(rs.running){parts.push(_('WARP Rescue SOCKS активен'));if(rs.endpoint)parts.push(rs.endpoint);}else parts.push(_('WARP Rescue SOCKS остановлен'));
			parts.push(_('автозапуск/самовосстановление: ')+(rs.autostart?_('ВКЛ'):_('ВЫКЛ')));
			parts.push(_('автоперезарядка: ')+(rs.auto?_('ВКЛ'):_('ВЫКЛ')));
			t.push({id:'warp_rescue',name:'WARP Rescue [warp_rescue]',configured:true,endpoint:rs.running?(rs.proxy||''):'',note:parts.join(' · '),_warp:true,_noProbe:!rs.running});
		}

		t.push({id:'tier4',name:_('Прямой выход WAN (tier4)'),configured:(d.tier4_wan_if&&d.tier4_wan_if!=='unknown'),endpoint:'direct',note:(d.tier4_wan_if&&d.tier4_wan_if!=='unknown')?(_('интерфейс ')+d.tier4_wan_if):_('WAN не определён')});
		t.push({id:'tier5',name:_('Аварийные IP Telegram (tier5)'),configured:true,endpoint:'',note:_('аварийные IP')});
		return t;
	},

	renderTiers:function(tiers,d){
		var self=this,active=(d.poll_route&&d.poll_route!=='unknown')?d.poll_route:((d.route&&d.route!=='unknown')?d.route:null);
		return E('div',{},tiers.map(function(t){
			var isActive=t.id===active;t._active=isActive;var cfgColour=isActive?'green':'grey',dotNode=dot(cfgColour,t.name+(isActive?'  ✓ '+_('активен'):''));t._dotNode=dotNode;
			var sysItem=self.bearResultFor(t.id),sysBadge=bearRouteBadge(sysItem);
			var probeBtn=(t.endpoint&&t.endpoint!==''&&!t._noProbe)?E('button',{'class':'cbi-button','style':'padding:.1em .6em;font-size:90%;','click':ui.createHandlerFn(self,'probeOne',t)},_('Тест')):E('span',{});
			var probeResult=E('span',{'id':'probe-'+t.id,'style':'margin-left:.6em;color:#888;font-size:90%;'});t._resultNode=probeResult;
			var extraBtn=E('span',{});
			if(t.id==='tier1')extraBtn=E('button',{'class':'cbi-button','style':'padding:.1em .4em;font-size:85%;','title':_('изменить порт Mixed Proxy'),'click':ui.createHandlerFn(self,'editTier1Port',t.endpoint)},'✎');
			else if(t.id==='tier3')extraBtn=E('button',{'class':'cbi-button','style':'padding:.1em .4em;font-size:85%;','title':_('задать или изменить свой прокси'),'click':ui.createHandlerFn(self,'editCustomProxy',t.endpoint)},'✎');
			else if(t.id==='tier4')extraBtn=E('button',{'class':'cbi-button','style':'padding:.1em .4em;font-size:85%;','title':_('выбрать интерфейс привязки'),'click':ui.createHandlerFn(self,'editBindIface')},'⚙');
			else if(t._warp)extraBtn=E('a',{'class':'cbi-button','style':'padding:.1em .5em;font-size:85%;','href':L.url('admin/services/podkop-bot/transport/warp-revolver')},_('WARP Rescue'));
			var crudBtns=E('span',{});
			if(t.id.indexOf('tier2_')===0&&t._fbIndex!=null)crudBtns=E('span',{'style':'display:inline-flex;gap:.2em;'},[
				E('button',{'class':'cbi-button','style':'padding:.1em .4em;font-size:85%;','title':_('редактировать'),'click':ui.createHandlerFn(self,'fbEdit',t._fbIndex,t.endpoint)},'✎'),
				E('button',{'class':'cbi-button','style':'padding:.1em .4em;font-size:85%;','title':_('выше в очереди'),'click':ui.createHandlerFn(self,'fbMove',t._fbIndex,'move_up')},'↑'),
				E('button',{'class':'cbi-button','style':'padding:.1em .4em;font-size:85%;','title':_('ниже в очереди'),'click':ui.createHandlerFn(self,'fbMove',t._fbIndex,'move_down')},'↓'),
				E('button',{'class':'cbi-button cbi-button-remove','style':'padding:.1em .4em;font-size:85%;','title':_('удалить'),'click':ui.createHandlerFn(self,'fbDelete',t._fbIndex,t.endpoint)},'✕')
			]);
			var dotWrap=E('span',{},[dotNode]);t._dotWrap=dotWrap;
			return E('div',{'style':'padding:.5em .2em;border-bottom:1px solid rgba(127,127,127,.12);'+(isActive?'background:rgba(51,160,44,.06);':'')},[
				E('div',{'style':'display:flex;align-items:center;flex-wrap:wrap;gap:.3em;'},[dotWrap,sysBadge,probeBtn,extraBtn,crudBtns]),probeResult,
				(t.endpoint&&t.endpoint!=='direct')?E('div',{'style':'color:#888;font-size:85%;margin-left:1.1em;font-family:monospace;word-break:break-all;'},fbDisplay(t.endpoint)):(t.note?E('div',{'style':'color:#888;font-size:85%;margin-left:1.1em;'},t.note):E('span',{})),
				(t.endpoint&&t.endpoint!=='direct'&&t.note)?E('div',{'style':'color:#888;font-size:82%;margin-left:1.1em;'},t.note):E('span',{}),
				(t.id==='tier1'&&!t.configured)?E('button',{'class':'cbi-button cbi-button-action','style':'margin:.4em 0 .2em 1.1em;padding:.1em .6em;font-size:90%;','click':ui.createHandlerFn(self,'enableMixedProxy')},_('Включить Mixed Proxy')):E('span',{})
			]);
		}));
	},

	refreshState:function(mutated){
		var self=this;if(mutated)clearChainProbeCache();
		return Promise.all([
			callState(),
			callRuntimeSections().catch(function(){return self.sectionsData;}),
			callWarpStatus('').catch(function(){return self.warpStatus;}),
			callRescueStatus().catch(function(){return self.rescueStatus;}),
			callBearStatus().catch(function(){return self.bearStatus;}),
			callBearResults().catch(function(){return self.bearResults;})
		]).then(function(res){
			self.state=res[0];self.sectionsData=res[1];self.warpStatus=res[2];self.rescueStatus=res[3];self.bearStatus=res[4]||self.bearStatus;self.bearResults=res[5]||self.bearResults;
			self.tiers=self.buildTiers(self.state);dom.content(self.chainBox,self.renderTiers(self.tiers,self.state));
			if(self.bearholeBox)dom.content(self.bearholeBox,[self.bearholeCard()]);
			/* A config mutation invalidates the cache above, but does not implicitly
			 * generate network traffic. The operator starts a full probe explicitly. */
			window.setTimeout(function(){self.applyChainCache();},60);
		});
	},

	fbAdd:function(input,status){var self=this,v=(input.value||'').trim();if(!v){dom.content(status,_('введите адрес'));return;}dom.content(status,_('добавление…'));return callFbCrud('add',v,0).then(function(r){if(r&&r.ok){input.value='';dom.content(status,_('добавлено'));return self.refreshState(true);}var m={bad_format:_('неверный формат (scheme://[логин:пароль@]IP:PORT[#имя])'),bad_port:_('порт вне диапазона 1–65535'),duplicate:_('уже в списке')};dom.content(status,_('ошибка: ')+(m[r&&r.reason]||(r&&r.detail)||'?'));}).catch(function(){dom.content(status,_('ошибка вызова'));});},
	fbDelete:function(index,endpoint){var self=this;ui.showModal(_('Удалить резервный прокси'),[E('p',{},_('Удалить ')+(endpoint||'')+'?'),E('div',{'class':'right'},[E('button',{'class':'cbi-button','click':ui.hideModal},_('Отмена')),' ',E('button',{'class':'cbi-button cbi-button-negative','click':ui.createHandlerFn(this,function(){ui.hideModal();return callFbCrud('delete','',index).then(function(){return self.refreshState(true);});})},_('Удалить'))])]);},
	fbMove:function(index,op){var self=this;return callFbCrud(op,'',index).then(function(){return self.refreshState(true);});},

	fbForm:function(index,current){
		var self=this,f=fbParse(current);
		var scheme=E('select',{'class':'cbi-input-select'},[E('option',{'value':'socks5h','selected':f.scheme==='socks5h'?'':null},'socks5h — DNS через прокси'),E('option',{'value':'socks5','selected':f.scheme==='socks5'?'':null},'socks5 — DNS локально'),E('option',{'value':'http','selected':f.scheme==='http'?'':null},'http'),E('option',{'value':'https','selected':f.scheme==='https'?'':null},'https')]);
		var host=E('input',{'type':'text','class':'cbi-input-text pb-mono','placeholder':_('хост / IP'),'value':f.host}),port=E('input',{'type':'text','class':'cbi-input-text pb-mono','placeholder':_('порт'),'value':f.port}),user=E('input',{'type':'text','class':'cbi-input-text pb-mono','placeholder':_('логин, необязательно'),'value':f.user}),pass=E('input',{'type':'password','class':'cbi-input-text pb-mono','placeholder':_('пароль, необязательно'),'value':f.pass}),mnem=E('input',{'type':'text','class':'cbi-input-text','placeholder':_('мнемоника (имя), необязательно'),'value':f.mnemonic}),err=E('div',{'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;'});
		var submit=function(){var vf={scheme:scheme.value||'socks5h',host:(host.value||'').trim(),port:(port.value||'').trim(),user:(user.value||'').trim(),pass:(pass.value||''),mnemonic:(mnem.value||'').trim()};if(['socks5h','socks5','http','https'].indexOf(vf.scheme)<0){dom.content(err,_('недопустимый тип'));return;}if(!vf.host){dom.content(err,_('укажите хост или IP'));return;}if(/\s/.test(vf.host)){dom.content(err,_('в хосте нельзя использовать пробелы'));return;}var pnum=parseInt(vf.port,10);if(!/^[0-9]+$/.test(vf.port)||pnum<1||pnum>65535){dom.content(err,_('порт должен быть числом 1–65535'));return;}if(vf.pass&&!vf.user){dom.content(err,_('пароль указан без логина'));return;}if(/[\s@/#]/.test(vf.user)){dom.content(err,_('в логине недопустимы пробел, @, /, #'));return;}if(/[\s@/#]/.test(vf.pass)){dom.content(err,_('в пароле недопустимы пробел, @, /, #'));return;}if(/[\s#]/.test(vf.mnemonic)){dom.content(err,_('в мнемонике нельзя пробел и #'));return;}var value=fbBuild(vf),op=index<0?'add':'edit';return callFbCrud(op,value,index<0?0:index).then(function(r){if(r&&r.ok){ui.hideModal();return self.refreshState(true);}var m={bad_format:_('неверный формат'),bad_port:_('порт вне диапазона 1–65535'),duplicate:_('такой прокси уже есть')};dom.content(err,m[r&&r.reason]||(r&&r.detail)||_('ошибка'));}).catch(function(){dom.content(err,_('ошибка вызова'));});};
		ui.showModal(index<0?_('Добавить резервный прокси'):_('Редактировать резервный прокси'),[E('div',{'class':'pb-manual-proxy-card','style':'border:none;padding:0;max-width:none;'},[E('div',{'class':'pb-manual-proxy-grid'},[scheme,host,port]),E('div',{'class':'pb-manual-proxy-auth'},[user,pass]),E('div',{'style':'margin-top:10px;'},[mnem])]),E('p',{'style':'color:#888;font-size:85%;margin-top:.6em;'},_('Логин, пароль и мнемоника необязательны. Пароль хранится в конфигурации открытым текстом и доступен root.')),err,E('div',{'class':'right','style':'margin-top:.6em;'},[E('button',{'class':'cbi-button','click':ui.hideModal},_('Отмена')),' ',E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(this,submit)},_('Сохранить'))])]);
	},
	fbEdit:function(index,current){return this.fbForm(index,current);},
	addFbRow:function(){return E('div',{'style':'margin-top:.8em;padding-top:.8em;border-top:1px solid rgba(127,127,127,.12);'},[E('div',{'style':'color:#888;font-size:85%;margin-bottom:.8em;line-height:1.7;'},[
		E('div',{'style':'margin-bottom:.3em;'},_('Редактирование доступно не для всех уровней:')),E('div',{'style':'padding-left:.6em;'},[
			E('div',{},_('• Podkop SOCKS5 (tier1): ✎ изменить порт Mixed Proxy')),E('div',{},_('• section_*: автоматически найденные Mixed Proxy других секций, только чтение')),E('div',{},_('• Резервные прокси (tier2): ✎ изменить · ↑ ↓ порядок перебора · ✕ удалить')),E('div',{},_('• Свой прокси (tier3): ✎ задать или изменить')),E('div',{},_('• WARP Rescue: появляется автоматически, когда WARPSCOUT установлен, учётная запись готова и Rescue включён')),E('div',{},_('• Прямой выход WAN (tier4): ⚙ выбрать интерфейс привязки')),E('div',{},_('• Аварийные IP Telegram (tier5) не редактируются'))
		])]),E('div',{'class':'pb-hint-90'},_('Для резервного прокси тип, хост, порт, логин, пароль и мнемоника вводятся отдельными полями.'))]);},

	editTier1Port:function(endpoint){var self=this,curPort='',m=(endpoint||'').match(/:(\d+)$/);if(m)curPort=m[1];var input=E('input',{'type':'text','class':'cbi-input-text','style':'width:100%;font-family:monospace;','value':curPort,'placeholder':'2080'}),err=E('div',{'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;'});ui.showModal(_('Порт Mixed Proxy (tier1)'),[E('p',{},_('Обычно порт определяется автоматически. Задайте его вручную, если порт Mixed Proxy был изменён в Podkop или автоопределение не сработало.')),input,err,E('div',{'class':'right','style':'margin-top:.6em;'},[E('button',{'class':'cbi-button','click':ui.hideModal},_('Отмена')),' ',E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){var v=(input.value||'').trim();return callSetTier1Port(v,(self.sectionsData&&self.sectionsData.primary_section)?self.sectionsData.primary_section:'').then(function(r){if(r&&r.ok){ui.hideModal();return self.refreshState(true);}var mm={bad_port:_('порт должен быть в диапазоне 1–65535'),no_section:_('активная секция не найдена'),commit_failed:_('ошибка записи конфигурации')};dom.content(err,mm[r&&r.reason]||(r&&r.detail)||_('ошибка'));}).catch(function(){dom.content(err,_('ошибка вызова'));});})},_('Сохранить'))])]);},

	editCustomProxy:function(current){
		var self=this,f=fbParse(current),scheme=E('select',{'class':'cbi-input-select'},[E('option',{'value':'socks5h','selected':f.scheme==='socks5h'?'':null},'socks5h — DNS через прокси'),E('option',{'value':'socks5','selected':f.scheme==='socks5'?'':null},'socks5 — DNS локально'),E('option',{'value':'http','selected':f.scheme==='http'?'':null},'http'),E('option',{'value':'https','selected':f.scheme==='https'?'':null},'https')]);
		var host=E('input',{'type':'text','class':'cbi-input-text pb-mono','placeholder':_('хост / IP'),'value':f.host}),port=E('input',{'type':'text','class':'cbi-input-text pb-mono','placeholder':_('порт'),'value':f.port}),user=E('input',{'type':'text','class':'cbi-input-text pb-mono','placeholder':_('логин, необязательно'),'value':f.user}),pass=E('input',{'type':'password','class':'cbi-input-text pb-mono','placeholder':_('пароль, необязательно'),'value':f.pass}),mnem=E('input',{'type':'text','class':'cbi-input-text','placeholder':_('мнемоника (имя), необязательно'),'value':f.mnemonic}),err=E('div',{'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;'});
		var save=function(clear){var value='';if(!clear){var vf={scheme:scheme.value||'socks5h',host:(host.value||'').trim(),port:(port.value||'').trim(),user:(user.value||'').trim(),pass:(pass.value||''),mnemonic:(mnem.value||'').trim()};if(!vf.host){dom.content(err,_('укажите хост или IP'));return;}if(/\s/.test(vf.host)){dom.content(err,_('в хосте нельзя пробелы'));return;}var pnum=parseInt(vf.port,10);if(!/^[0-9]+$/.test(vf.port)||pnum<1||pnum>65535){dom.content(err,_('порт 1–65535'));return;}if(vf.pass&&!vf.user){dom.content(err,_('пароль без логина'));return;}if(/[\s@/#]/.test(vf.user)){dom.content(err,_('в логине недопустимы пробел, @, /, #'));return;}if(/[\s@/#]/.test(vf.pass)){dom.content(err,_('в пароле недопустимы пробел, @, /, #'));return;}if(/[\s#]/.test(vf.mnemonic)){dom.content(err,_('в мнемонике нельзя пробел и #'));return;}value=fbBuild(vf);}return callSetField('custom_proxy',value).then(function(r){if(r&&r.ok){ui.hideModal();return self.refreshState(true);}var m={bad_format:_('неверный формат'),bad_port:_('порт вне диапазона')};dom.content(err,m[r&&r.reason]||(r&&r.detail)||_('ошибка'));}).catch(function(){dom.content(err,_('ошибка вызова'));});};
		ui.showModal(_('Свой прокси (tier3)'),[E('div',{'class':'pb-manual-proxy-card','style':'border:none;padding:0;max-width:none;'},[E('div',{'class':'pb-manual-proxy-grid'},[scheme,host,port]),E('div',{'class':'pb-manual-proxy-auth'},[user,pass]),E('div',{'style':'margin-top:10px;'},[mnem])]),E('p',{'style':'color:#888;font-size:85%;margin-top:.6em;'},_('Логин, пароль и мнемоника необязательны. Пароль хранится в конфигурации открытым текстом и доступен root.')),err,E('div',{'class':'right','style':'margin-top:.6em;'},[E('button',{'class':'cbi-button cbi-button-negative','click':ui.createHandlerFn(this,function(){return save(true);})},_('Убрать tier3')),' ',E('button',{'class':'cbi-button','click':ui.hideModal},_('Отмена')),' ',E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){return save(false);})},_('Сохранить'))])]);
	},

	editBindIface:function(){var self=this;return callListIfaces().then(function(d){var ifaces=(d&&d.interfaces)||[],current=(d&&d.current)||'',sel=E('select',{'class':'cbi-input-select','style':'width:100%;'},[E('option',{'value':''},_('Авто (без привязки)'))].concat(ifaces.map(function(i){return E('option',{'value':i},i);})));sel.value=current||'';var err=E('div',{'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;'});ui.showModal(_('Интерфейс прямого WAN'),[E('p',{},_('Интерфейс, к которому привязывается прямой выход. В режиме «Авто» интерфейс выбирает система.')),sel,err,E('div',{'class':'right','style':'margin-top:.6em;'},[E('button',{'class':'cbi-button','click':ui.hideModal},_('Отмена')),' ',E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(self,function(){return callSetField('bind_interface',sel.value).then(function(r){if(r&&r.ok){ui.hideModal();return self.refreshState(true);}dom.content(err,(r&&r.detail)||_('ошибка'));}).catch(function(){dom.content(err,_('ошибка вызова'));});})},_('Сохранить'))])]);}).catch(function(){ui.addNotification(null,E('p',{},_('Не удалось получить список интерфейсов')),'error');});},

	probeOne:function(t){var node=t._resultNode,self=this;dom.content(node,_('проверка…'));var target=t.id==='tier4'?'direct':fbEndpoint(t.endpoint);function recolour(c){if(t._dotWrap)dom.content(t._dotWrap,[dot(c,t.name+(t._active?'  ✓ '+_('активен'):''))]);}function store(html,colour){_chainCache[chainKey(t)]={html:html,colour:colour,active:!!t._active};saveChainProbeCache();}return callProbe(target).then(function(r){if(r&&r.result==='ok'){var ms=(r.latency_ms!=null&&r.latency_ms>0)?(' · '+r.latency_ms+' мс'):'';var html='✓ OK'+(r.http?(' ('+r.http+')'):'')+ms;dom.content(node,html);recolour('green');store(html,'green');}else if(r&&r.result==='unknown'){var h='— '+(r.reason||'unknown');dom.content(node,h);store(h,'grey');}else{var hf='✗ FAIL'+(r&&r.http?(' ('+r.http+')'):'');dom.content(node,hf);recolour('yellow');store(hf,'yellow');}}).catch(function(){var he='✗ '+_('ошибка');dom.content(node,he);recolour('yellow');store(he,'yellow');});},
	testFullChain:function(){
		var self=this;
		if(this._chainProbePromise)return this._chainProbePromise;
		var seq=this.tiers.filter(function(t){return t.endpoint&&t.endpoint!==''&&!t._noProbe;}),i=0;
		if(this._testAllBtn)this._testAllBtn.disabled=true;
		function progress(t){
			if(!self._chainMeta)return;
			var name=t?(t.name||t.id||''):_('завершение');
			dom.content(self._chainMeta,_('Проверка цепочки: ')+String(Math.min(i+1,seq.length))+' / '+String(seq.length)+(name?' · '+name:''));
		}
		function finish(){
			_chainCheckedAt=Math.floor(Date.now()/1000);_chainTestedThisSession=true;saveChainProbeCache();
			self.renderChainMeta();if(self._testAllBtn)self._testAllBtn.disabled=false;self._chainProbePromise=null;
		}
		function fail(){
			if(self._chainMeta)dom.content(self._chainMeta,_('Проверка цепочки прервана. Нажмите «Проверить всю цепочку», чтобы повторить.'));
			if(self._testAllBtn)self._testAllBtn.disabled=false;self._chainProbePromise=null;
		}
		function next(){
			if(i>=seq.length){finish();return Promise.resolve();}
			var t=seq[i];progress(t);return self.probeOne(t).then(function(){i++;return next();});
		}
		if(!seq.length){finish();return Promise.resolve();}
		this._chainProbePromise=Promise.resolve().then(next).catch(function(e){fail();throw e;});
		return this._chainProbePromise;
	},
	applyChainCache:function(){(this.tiers||[]).forEach(function(t){var c=_chainCache[chainKey(t)];if(!c)return;if(t._resultNode)dom.content(t._resultNode,c.html);if(t._dotWrap)dom.content(t._dotWrap,[dot(c.colour,t.name+(c.active?'  ✓ '+_('активен'):''))]);});this.renderChainMeta();},
	renderChainMeta:function(){if(!this._chainMeta)return;if(!_chainCheckedAt){dom.content(this._chainMeta,'');return;}var d=new Date(_chainCheckedAt*1000);dom.content(this._chainMeta,_('Последняя проверка цепочки: ')+d.toLocaleString());},
	enableMixedProxy:function(){var self=this;ui.showModal(_('Включить Mixed Proxy'),[E('p',{},_('Включить Mixed Proxy для основной секции? Это необходимо для работы tier1 — быстрого SOCKS Podkop.')),E('div',{'class':'right'},[E('button',{'class':'cbi-button','click':ui.hideModal},_('Отмена')),' ',E('button',{'class':'cbi-button cbi-button-action','click':ui.createHandlerFn(this,function(){ui.hideModal();return callEnsureMP().then(function(r){if(r&&r.ok){var msg=r.already_enabled?_('Mixed Proxy уже включён'):(r.probe==='ok'?_('Mixed Proxy включён, SOCKS отвечает'):_('Mixed Proxy включён'));ui.addNotification(null,E('p',{},msg+(r.endpoint?(' · '+r.endpoint):'')),'info');return self.refreshState(true);}var rm={not_proxy_section:_('Секция не является прокси-секцией — Mixed Proxy неприменим'),probe_failed:_('Mixed Proxy включён, но SOCKS не ответил — изменения отменены'),variant_unknown:_('Вариант Podkop не определён'),uci_missing:_('Конфигурация Podkop не найдена'),commit_failed:_('Ошибка записи конфигурации')};ui.addNotification(null,E('p',{},_('Не удалось включить: ')+(rm[r&&r.reason]||(r&&r.detail)||'?')),'error');}).catch(function(){ui.addNotification(null,E('p',{},_('Ошибка вызова')),'error');});})},_('Включить'))])]);},
	row:function(label,valNode){return E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},label),E('span',{'class':'pb-row-val'},[valNode])]);},
	handleSave:null,handleSaveApply:null,handleReset:null
});

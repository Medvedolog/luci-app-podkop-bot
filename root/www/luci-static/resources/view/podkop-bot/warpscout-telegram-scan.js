'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callStatus = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_status' });
var callPlan = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_plan' });
var callResults = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_results' });
var callStart = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_start' });
var callCancel = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_cancel' });
var callLog = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_log', params:['offset'] });
var callTransportState = rpc.declare({ object:'podkop_bot', method:'transport_state' });

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:center;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}
function row(label,value){return E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},label),E('span',{'class':'pb-row-val'},value)]);}
function card(title,children){return E('div',{'class':'cbi-section','style':'max-width:1080px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;margin-top:1em;'},[E('h3',{'style':'margin-top:0;'},title)].concat(children));}
function pbInjectCss(){if(document.getElementById('pb-css'))return;document.querySelector('head').appendChild(E('link',{'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')}));}
function phaseText(p){return ({queued:_('Подготовка маршрутов'),tunnel_start:_('Запуск WARP tunnel'),telegram_test:_('Telegram Bot API'),cleanup:_('Остановка WARP tunnel'),done:_('Завершено'),cancelled:_('Отменено')})[p]||p||'—';}
function statusNode(x){var s=x.status||'';if(s==='VALID')return dot('green',_('VALID'));if(s==='REACHABLE_RATE_LIMITED')return dot('yellow',_('Доступен · 429'));if(s==='REACHABLE_AUTH')return dot('yellow',_('Доступен · 401'));if(s==='REACHABLE_DENIED')return dot('yellow',_('Доступен · 403'));return dot('red',_('FAIL · ')+(x.reason||'?'));}
function providerLabel(x){if(x.provider==='warp')return 'WARPSCOUT';if(x.source_id==='tier1')return 'Transport · tier1';if((x.source_id||'').indexOf('tier2_')===0)return 'Transport · '+x.source_id;if(x.source_id==='tier3')return 'Transport · tier3';if((x.source_id||'').indexOf('section_')===0)return 'Podkop section';return x.provider||'—';}
function ageText(ts){var n=parseInt(ts||0,10);if(!n)return '—';var s=Math.max(0,Math.floor(Date.now()/1000)-n);if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');}
function routeMatches(x,key,name){key=String(key||'');name=String(name||'');var id=String(x.source_id||''),label=String(x.label||''),ep=String(x.endpoint||'');if(!key&&!name)return false;return key===id||key===label||name===id||name===label||name===ep;}
function usageNode(x,t){var tags=[];if(routeMatches(x,t.poll_route,t.poll_route_name))tags.push(E('span',{'class':'label','style':'margin-right:.3em;'},'POLL'));if(routeMatches(x,t.fast_route,t.fast_route_name))tags.push(E('span',{'class':'label'},'FAST'));return tags.length?E('span',{},tags):E('span',{},'—');}

return view.extend({
	load:function(){pbInjectCss();return Promise.all([callStatus().catch(function(){return {state:'idle'};}),callPlan().catch(function(){return {items:[]};}),callResults().catch(function(){return {items:[]};}),callLog(0).catch(function(){return {chunk:'',offset:0};}),callTransportState().catch(function(){return {};})]);},
	render:function(data){this.scanStatus=data[0]||{state:'idle'};this.scanPlan=data[1]||{items:[]};this.scanResults=data[2]||{items:[]};this.logOffset=(data[3]&&data[3].offset)||0;this.transportState=data[4]||{};this.root=E('div',{});this.logText=(data[3]&&data[3].chunk)||'';this.lastResultsCurrent=parseInt(this.scanStatus.current||0,10)||0;this.lastResultsAt=Date.now();dom.content(this.root,this.renderBody());this.installVisibilityHooks();if(this.scanStatus.running)this.schedulePoll(200);return this.root;},
	renderBody:function(){
		var self=this,st=this.scanStatus||{},items=(this.scanResults&&this.scanResults.items)||[],latest=0;items.forEach(function(x){latest=Math.max(latest,parseInt(x.checked_at||0,10)||0);});
		var start=E('button',{'class':'cbi-button cbi-button-action','disabled':st.running?'disabled':null,'click':ui.createHandlerFn(this,function(){start.disabled=true;dom.content(self.actionStatus,dot('yellow',_('Проверяю доступные маршруты Telegram Bot API…')));return callStart().then(function(r){if(!r||!r.ok){start.disabled=false;dom.content(self.actionStatus,dot('red',_('Не удалось запустить: ')+((r&&r.reason)||'?')));return;}self.logOffset=0;self.logText='';return self.refreshFull().then(function(){self.schedulePoll(200);});}).catch(function(){start.disabled=false;dom.content(self.actionStatus,dot('red',_('Ошибка RPC')));});})},_('Проверить все TG API routes'));
		var cancel=E('button',{'class':'cbi-button cbi-button-negative','disabled':!st.running?'disabled':null,'click':ui.createHandlerFn(this,function(){cancel.disabled=true;return callCancel().then(function(){return self.refreshFull();});})},_('Остановить проверку'));
		this.actionStatus=E('div',{'style':'margin-top:.6em;'});this.logPre=E('pre',{'style':'max-width:100%;box-sizing:border-box;max-height:360px;overflow:auto;padding:.7em;border-radius:6px;white-space:pre-wrap;font-family:monospace;font-size:82%;line-height:1.35;'},this.logText||_('Лог пуст.'));
		var resultsNode=this.resultsTable(items);
		if(this.scanResults&&this.scanResults.ok===false)resultsNode=E('div',{},[dot('red',_('Не удалось разобрать результаты квалификации.')),E('div',{'class':'pb-hint-90','style':'margin-top:.4em;'},_('Строк в raw results: ')+String(this.scanResults.raw_count||0)+' · '+String(this.scanResults.reason||'parse_error'))]);
		return E('div',{},[E('h2',{},_('TG API Routes')),E('p',{'class':'pb-hint-90','style':'max-width:1080px;'},_('Проверяет все известные маршруты к Telegram Bot API: Podkop/Forkop sections, transport proxy tiers и WARPSCOUT shortlist. Текущие POLL/FAST показаны только для справки; эта вкладка сама маршруты не переключает.')),
			card(_('Прогресс'),[row(_('Состояние'),this.stateNode(st)),row(_('Прогресс'),String(st.current||0)+' / '+String(st.total||0)),row(_('Текущий route'),st.endpoint||'—'),row(_('Фаза'),phaseText(st.phase)),row(_('Последний полный/частичный результат'),ageText(latest)),row(_('VALID'),String(st.passed||0)),row(_('Telegram доступен, но не VALID'),String(st.reachable||0)),row(_('FAIL'),String(st.failed||0)),E('p',{'class':'pb-hint-90'},_('Ниже — весь план проверки, а не только WARP: каждый настроенный proxy/section и каждый WARP endpoint из shortlist. Статусы обновляются по мере выполнения.')),this.routeSummary(),E('p',{'class':'pb-hint-90'},_('Telegram timeout: connect-timeout 5 s, max-time 12 s. HTTP 401/403/429 подтверждает достижимость Telegram, но такой route не считается VALID.')),E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;margin-top:.7em;'},[start,cancel]),this.actionStatus]),
			card(_('Результаты'),[resultsNode]),card(_('Журнал'),[this.logPre])]);
	},
	stateNode:function(st){if(st.state==='done')return dot('green',_('Завершено'));if(st.state==='running')return dot('yellow',_('Выполняется'));if(st.state==='cancelled')return dot('grey',_('Отменено'));if(st.state==='stale')return dot('red',_('Worker завершился неожиданно'));return dot('grey',_('Не запущено'));},
	routeSummary:function(){
		var st=this.scanStatus||{},plan=(this.scanPlan&&this.scanPlan.items)||[],results=(this.scanResults&&this.scanResults.items)||[],by={};
		results.forEach(function(r){by[String(r.source_id||'')+'|'+String(r.endpoint||'')]=r;});
		if(!plan.length){
			if(results.length)plan=results.map(function(r){return r;});
			else return E('div',{'class':'pb-hint-90'},_('План появится после запуска проверки.'));
		}
		var cur=parseInt(st.current||0,10)||0;
		return E('div',{'style':'margin-top:.6em;border-top:1px solid rgba(127,127,127,.14);'},plan.map(function(p,i){
			var r=by[String(p.source_id||'')+'|'+String(p.endpoint||'')]||null, idx=i+1, state;
			if(r) state=statusNode(r);
			else if(st.running&&idx===cur) state=dot('yellow',_('ПРОВЕРЯЕТСЯ'));
			else if(st.running&&idx>cur) state=dot('grey',_('ОЖИДАЕТ'));
			else if(st.running&&idx<cur) state=dot('grey',_('ЗАВЕРШЁН'));
			else state=dot('grey',_('НЕТ РЕЗУЛЬТАТА'));
			var meta=providerLabel(p)+' · '+(p.endpoint||'—');
			if(p.provider==='warp')meta+=' · '+(p.node||'—')+(p.node_location?(' / '+p.node_location):'');
			return E('div',{'style':'display:flex;justify-content:space-between;gap:1em;align-items:center;padding:.45em 0;border-bottom:1px solid rgba(127,127,127,.1);flex-wrap:wrap;'},[
				E('div',{},[E('strong',{},String(idx)+'. '+(p.label||p.source_id||'route')),E('div',{'class':'pb-hint-90'},meta)]),state
			]);
		}));
	},
	resultsTable:function(items){var self=this;if(!items.length)return E('p',{'class':'pb-hint-90'},_('Результатов пока нет. Таблица будет наполняться по мере проверки маршрутов.'));var rows=items.map(function(x,i){var metrics=x.provider==='warp'?((x.loss||'—')+' / '+(x.tunnel_ping||'—')):'—';var node=x.provider==='warp'?((x.node||'—')+' · '+(x.node_location||'—')):'—';return E('tr',{},[E('td',{},String(i+1)),E('td',{},x.label||x.source_id||'—'),E('td',{},providerLabel(x)),E('td',{},usageNode(x,self.transportState||{})),E('td',{},x.endpoint||'—'),E('td',{},[statusNode(x)]),E('td',{},x.http||'—'),E('td',{},x.latency_ms?String(x.latency_ms)+' ms':'—'),E('td',{},ageText(x.checked_at)),E('td',{},metrics),E('td',{},node)]);});return E('div',{'style':'overflow-x:auto;'},[E('table',{'class':'table','style':'min-width:1180px;'},[E('thead',{},[E('tr',{},[E('th',{},'#'),E('th',{},_('Route')),E('th',{},_('Source')),E('th',{},_('Сейчас')),E('th',{},_('Endpoint')),E('th',{},_('Telegram')),E('th',{},_('HTTP')),E('th',{},_('TG latency')),E('th',{},_('Возраст')),E('th',{},_('Loss / tunnel')),E('th',{},_('Node'))])]),E('tbody',{},rows)])]);},
	appendLog:function(l){if(!l)return;if(typeof l.offset==='number')this.logOffset=l.offset;if(l.chunk)this.logText=(this.logText||'')+l.chunk;},
	refreshFull:function(){var self=this;return Promise.all([callStatus(),callPlan().catch(function(){return {items:[]};}),callResults(),callTransportState().catch(function(){return {};}),callLog(this.logOffset||0).catch(function(){return null;})]).then(function(x){self.scanStatus=x[0]||{};self.scanPlan=x[1]||{items:[]};self.scanResults=x[2]||{items:[]};self.transportState=x[3]||{};self.appendLog(x[4]);self.lastResultsCurrent=parseInt(self.scanStatus.current||0,10)||0;self.lastResultsAt=Date.now();dom.content(self.root,self.renderBody());});},
	refreshLight:function(){var self=this;return Promise.all([callStatus(),callLog(this.logOffset||0).catch(function(){return null;})]).then(function(x){var prev=self.scanStatus||{},next=x[0]||{};self.scanStatus=next;self.appendLog(x[1]);var cur=parseInt(next.current||0,10)||0,now=Date.now(),needResults=(cur!==self.lastResultsCurrent)||((now-(self.lastResultsAt||0))>=4500)||(!next.running&&prev.running);if(needResults)return Promise.all([callResults(),callPlan().catch(function(){return self.scanPlan||{items:[]};})]).then(function(r){self.scanResults=r[0]||{items:[]};self.scanPlan=r[1]||{items:[]};self.lastResultsCurrent=cur;self.lastResultsAt=now;});}).then(function(){dom.content(self.root,self.renderBody());});},
	pollOnce:function(){var self=this;if(document.visibilityState!=='visible'||(document.hasFocus&&!document.hasFocus())){self.schedulePoll(1500);return;}this.refreshLight().then(function(){if(self.scanStatus&&self.scanStatus.running)self.schedulePoll(1500);else self.refreshFull();}).catch(function(){self.schedulePoll(2200);});},
	schedulePoll:function(ms){var self=this;if(this.pollTimer)window.clearTimeout(this.pollTimer);this.pollTimer=window.setTimeout(function(){self.pollOnce();},ms||1500);},
	installVisibilityHooks:function(){var self=this;if(this._hooks)return;this._hooks=true;document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&self.scanStatus&&self.scanStatus.running)self.schedulePoll(100);});window.addEventListener('focus',function(){if(self.scanStatus&&self.scanStatus.running)self.schedulePoll(100);});},
	handleSave:null,handleSaveApply:null,handleReset:null
});
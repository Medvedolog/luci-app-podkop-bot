'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callTgStatus = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_status' });
var callTgResults = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_results' });
var callTgPlan = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_plan' });
var callTgStart = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_start' });
var callTgCancel = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_cancel' });
var callTransportState = rpc.declare({ object:'podkop_bot', method:'transport_state' });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:center;gap:.35em;min-width:0;'},[E('span',{'style':'width:.65em;height:.65em;border-radius:50%;display:inline-block;flex:none;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{'style':'min-width:0;overflow-wrap:anywhere;'},label)]);}
function ageText(ts){var n=parseInt(ts||0,10);if(!n)return '—';var s=Math.max(0,Math.floor(Date.now()/1000)-n);if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');}
function statusNode(x){var s=x&&x.status||'';if(s==='VALID')return dot('green','VALID');if(s.indexOf('REACHABLE_')===0)return dot('yellow',s.replace('REACHABLE_',''));if(s==='FAIL')return dot('red','FAIL');return dot('grey',_('ОЖИДАЕТ'));}
function injectCss(){if(document.getElementById('pb-css'))return;document.querySelector('head').appendChild(E('link',{'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')}));}

return view.extend({
	load:function(){
		injectCss();
		return Promise.all([
			callTgStatus().catch(function(){return {state:'idle',running:false};}),
			callTgResults().catch(function(){return {ok:true,items:[]};}),
			callTgPlan().catch(function(){return {ok:false,items:[]};}),
			callTransportState().catch(function(){return {}; }),
			callRescueStatus().catch(function(){return {running:false,endpoint:''};})
		]);
	},

	render:function(data){
		this.tgScanStatus=data[0]||{state:'idle',running:false};
		this.tgScanResults=data[1]||{ok:true,items:[]};
		this.tgScanPlan=data[2]||{ok:false,items:[]};
		this.transportState=data[3]||{};
		this.rescueStatus=data[4]||{running:false,endpoint:''};
		this.tgBody=E('div',{'style':'margin:.7em 0;'},this.renderSummary());
		this.tgBtn=E('button',{'class':'cbi-button cbi-button-action','disabled':this.tgScanStatus.running?'disabled':null,'click':ui.createHandlerFn(this,'startScan')},_('Проверить Telegram'));
		this.stopBtn=E('button',{'class':'cbi-button cbi-button-negative','style':this.tgScanStatus.running?'':'display:none;','click':ui.createHandlerFn(this,'cancelScan')},_('Остановить'));
		var root=E('div',{},[
			E('h2',{},_('Telegram по маршрутам')),
			E('p',{'class':'pb-muted'},_('Быстрая проверка Telegram Bot API через все настроенные маршруты: Podkop/Forkop, резервные прокси, Custom Proxy и найденные WARP-узлы.')),
			E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;margin:.6em 0;'},[this.tgBtn,this.stopBtn]),
			this.tgBody
		]);
		if(this.tgScanStatus.running)this.schedulePoll(250);
		return root;
	},

	usageTags:function(x){
		var t=this.transportState||{},tags=[],id=String(x.source_id||''),label=String(x.label||''),ep=String(x.endpoint||'');
		function match(k,n){k=String(k||'');n=String(n||'');return !!((k&&(k===id||k===label||k===ep))||(n&&(n===id||n===label||n===ep)));}
		if(match(t.poll_route,t.poll_route_name))tags.push('POLL');
		if(match(t.fast_route,t.fast_route_name))tags.push('FAST');
		if(this.rescueStatus&&this.rescueStatus.running&&ep===this.rescueStatus.endpoint)tags.push('ON-AIR');
		return tags;
	},

	renderSummary:function(){
		var self=this,st=this.tgScanStatus||{},res=(this.tgScanResults&&this.tgScanResults.items)||[],plan=(this.tgScanPlan&&this.tgScanPlan.items)||[],byKey={};
		res.forEach(function(x){byKey[(x.source_id||'')+'|'+(x.endpoint||'')]=x;});
		var rows=(plan.length?plan:res).map(function(p,i){
			var x=byKey[(p.source_id||'')+'|'+(p.endpoint||'')]||p,checking=st.running&&parseInt(st.current||0,10)===i+1&&!x.status,status=checking?dot('yellow',_('ПРОВЕРЯЕТСЯ')):statusNode(x),tags=self.usageTags(x),meta=[];
			if(x.latency_ms)meta.push(_('Задержка TG ')+x.latency_ms+' мс');
			if(x.http)meta.push('HTTP '+x.http);
			if(x.provider==='warp'&&(x.node||x.node_location))meta.push((x.node||'—')+' · '+(x.node_location||'—'));
			if(x.loss)meta.push(_('Потери ')+x.loss);
			if(x.checked_at)meta.push(ageText(x.checked_at));
			return E('div',{'style':'border-top:1px solid rgba(127,127,127,.14);padding:.55em 0;min-width:0;'},[
				E('div',{'style':'display:flex;justify-content:space-between;gap:.65em;align-items:flex-start;flex-wrap:wrap;min-width:0;'},[
					E('div',{'style':'min-width:0;flex:1 1 300px;'},[
						E('strong',{'style':'display:block;overflow-wrap:anywhere;'},x.label||x.source_id||(_('маршрут ')+(i+1))),
						x.endpoint?E('code',{'style':'display:block;color:#888;margin-top:.15em;white-space:normal;overflow-wrap:anywhere;word-break:break-word;'},x.endpoint):E('span',{})
					]),
					E('div',{'style':'display:flex;gap:.35em;align-items:center;flex-wrap:wrap;flex:0 1 auto;max-width:100%;'},tags.map(function(z){return E('span',{'class':'label'},z);}).concat([status]))
				]),
				meta.length?E('div',{'class':'pb-hint-90','style':'margin-top:.25em;overflow-wrap:anywhere;'},meta.join(' · ')):E('span',{})
			]);
		});
		var head=st.running?dot('yellow',_('Проверка ')+String(st.current||0)+' / '+String(st.total||0)):((st.state==='done')?dot('green',_('Последняя проверка завершена')):dot('grey',_('Последние сохранённые результаты')));
		var summary=_('Доступны')+' '+String(st.passed||0)+' · '+_('частично')+' '+String(st.reachable||0)+' · '+_('недоступны')+' '+String(st.failed||0);
		return E('div',{'class':'cbi-section pb-card','style':'width:100%;max-width:1080px;box-sizing:border-box;overflow:hidden;'},[
			E('div',{'style':'display:flex;justify-content:space-between;gap:.7em;flex-wrap:wrap;min-width:0;'},[head,E('strong',{'style':'overflow-wrap:anywhere;'},summary)]),
			st.running&&st.endpoint?E('div',{'class':'pb-hint-90','style':'margin-top:.35em;overflow-wrap:anywhere;'},_('Сейчас проверяется: ')+st.endpoint):E('span',{}),
			E('div',{'style':'margin-top:.45em;min-width:0;'},rows.length?rows:E('div',{'class':'pb-muted'},_('Сохранённых результатов пока нет.')))
		]);
	},

	refresh:function(){
		var self=this;
		return Promise.all([callTgStatus(),callTgResults(),callTgPlan(),callTransportState(),callRescueStatus()]).then(function(x){
			self.tgScanStatus=x[0]||{state:'idle',running:false};self.tgScanResults=x[1]||{ok:true,items:[]};self.tgScanPlan=x[2]||{ok:false,items:[]};self.transportState=x[3]||{};self.rescueStatus=x[4]||{running:false,endpoint:''};
			dom.content(self.tgBody,self.renderSummary());
			self.tgBtn.disabled=!!self.tgScanStatus.running;
			self.stopBtn.style.display=self.tgScanStatus.running?'':'none';
			return self.tgScanStatus;
		}).catch(function(){return self.tgScanStatus||{};});
	},

	schedulePoll:function(delay){
		var self=this;
		window.setTimeout(function(){self.refresh().then(function(st){if(st&&st.running)self.schedulePoll(1200);});},delay||1200);
	},

	startScan:function(){
		var self=this;this.tgBtn.disabled=true;
		return callTgStart().then(function(r){if(!r||r.ok===false)throw new Error((r&&r.reason)||'telegram_scan_start_failed');return self.refresh();}).then(function(){self.schedulePoll(300);}).catch(function(e){ui.addNotification(null,E('p',{},_('Не удалось запустить проверку Telegram: ')+((e&&e.message)||'?')),'error');self.tgBtn.disabled=false;});
	},

	cancelScan:function(){
		var self=this;this.stopBtn.disabled=true;
		return callTgCancel().catch(function(){return null;}).then(function(){return self.refresh();}).finally(function(){self.stopBtn.disabled=false;});
	},

	handleSaveApply:null,
	handleSave:null,
	handleReset:null
});

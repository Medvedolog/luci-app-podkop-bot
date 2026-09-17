'use strict';
'require view.podkop-bot.runtime as base';
'require rpc';
'require ui';
'require dom';

var callProbeStart = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_start', params:['section','proxy','label','restore_warp'] });
var callProbeStatus = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_status' });
var callProbeResult = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_result' });
var callEnsureMixedProxy = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy', params:['section'] });
var callCachedProbe = rpc.declare({ object:'podkop_bot', method:'active_probe', params:['cached','section','proxy','label'] });
var callRuntimeSections = rpc.declare({ object:'podkop_bot', method:'runtime_sections' });
var callTransportState = rpc.declare({ object:'podkop_bot', method:'transport_state' });
var callWarpStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callWarpShortlist = rpc.declare({ object:'podkop_bot_warpscout', method:'shortlist' });
var callWarpRtStatus = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'status' });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });
var callTgStatus = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_status' });
var callTgResults = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_results' });
var callTgPlan = rpc.declare({ object:'podkop_bot_warpscout_tgscan', method:'telegram_scan_plan' });

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;min-width:0;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{'style':'min-width:0;overflow-wrap:anywhere;'},label)]);}
function ageText(ts){var n=parseInt(ts||0,10);if(!n)return '—';var s=Math.max(0,Math.floor(Date.now()/1000)-n);if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');}
function tgStatusNode(x){var s=x&&x.status||'';if(s==='VALID')return dot('green','VALID');if(s.indexOf('REACHABLE_')===0)return dot('yellow',s.replace('REACHABLE_',''));if(s==='FAIL')return dot('red','FAIL');return dot('grey',_('ОЖИДАЕТ'));}
function injectCss(){if(document.getElementById('pb-css'))return;document.querySelector('head').appendChild(E('link',{'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')}));}

function asyncProbe(section, proxy, label, restoreWarp, onTick) {
	return callProbeStart(section||'', proxy||'', label||'', restoreWarp?'true':'false').then(function(r) {
		if (!r || !r.ok) throw new Error((r && r.reason) || 'probe_start_failed');
		return new Promise(function(resolve, reject) {
			var failures=0;
			function tick() {
				callProbeStatus().then(function(st) {
					failures=0;
					if (onTick) onTick(st||{});
					if (st && st.running) { window.setTimeout(tick, 1400); return; }
					return callProbeResult().then(function(d) {
						if (d && d.running) { window.setTimeout(tick, 700); return; }
						resolve(d);
					});
				}).catch(function(e) {
					failures++;
					if (failures < 20) { window.setTimeout(tick, 1800); return; }
					reject(e || new Error('probe_status_unavailable'));
				});
			}
			tick();
		});
	});
}

function showFailure(self, text) {
	self.endProgress();
	dom.content(self.body, self.renderProbe({ available:false, detail:text || _('Проверка не завершилась.') }));
}

/* LuCI require() injects a dependency instance. Return a subclass constructor,
 * never the imported instance itself, otherwise luci.js rejects the module with
 * "factory yields invalid constructor". */
return base.constructor.extend({
	/* First paint waits only for the two cheap topology calls. The cached full
	 * probe, WARP and Telegram diagnostics are hydrated after the page is visible. */
	load:function(){
		injectCss();
		return Promise.all([
			callRuntimeSections().catch(function(){return null;}),
			callTransportState().catch(function(){return null;})
		]).then(function(x){
			return [x[0],null,x[1],null,{items:[]},null,{state:'idle',running:false},{ok:true,items:[]},{ok:false,items:[]},{running:false,endpoint:''}];
		});
	},

	render:function(data){
		var self=this,root=E('div',{'id':'podkop-runtime-async-root'}),first=base.render.call(this,data);
		if(this.tgBtn)this.tgBtn.textContent=_('Проверить Telegram');
		dom.content(root,[first]);
		this._asyncRoot=root;
		window.setTimeout(function(){self.hydrateRuntime(data,root);},0);
		return root;
	},

	hydrateRuntime:function(seed,root){
		var self=this;
		return Promise.all([
			callCachedProbe('true','','','').catch(function(){return null;}),
			callWarpStatus('').catch(function(){return null;}),
			callWarpShortlist().catch(function(){return null;}),
			callWarpRtStatus().catch(function(){return null;}),
			callTgStatus().catch(function(){return {state:'idle',running:false};}),
			callTgResults().catch(function(){return null;}),
			callTgPlan().catch(function(){return {ok:false,items:[]};}),
			callRescueStatus().catch(function(){return {running:false,endpoint:''};})
		]).then(function(x){
			if(self._asyncRoot!==root||!root.parentNode)return;
			var full=[seed[0],x[0],seed[2],x[1],x[2],x[3],x[4],x[5],x[6],x[7]];
			var view=base.render.call(self,full);
			if(self.tgBtn)self.tgBtn.textContent=_('Проверить Telegram');
			dom.content(root,[view]);
		});
	},

	renderTgSummary:function(){
		var self=this,st=this.tgScanStatus||{},res=(this.tgScanResults&&this.tgScanResults.items)||[],plan=(this.tgScanPlan&&this.tgScanPlan.items)||[],byKey={};
		res.forEach(function(x){byKey[(x.source_id||'')+'|'+(x.endpoint||'')]=x;});
		var rows=(plan.length?plan:res).map(function(p,i){
			var x=byKey[(p.source_id||'')+'|'+(p.endpoint||'')]||p,checking=st.running&&parseInt(st.current||0,10)===i+1&&!x.status,status=checking?dot('yellow',_('ПРОВЕРЯЕТСЯ')):tgStatusNode(x),tags=self.tgUsageTags(x),meta=[];
			if(x.latency_ms)meta.push(_('Задержка TG ')+x.latency_ms+' мс');if(x.http)meta.push('HTTP '+x.http);if(x.provider==='warp'&&(x.node||x.node_location))meta.push((x.node||'—')+' · '+(x.node_location||'—'));if(x.loss)meta.push(_('Потери ')+x.loss);if(x.checked_at)meta.push(ageText(x.checked_at));
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
		if(!st.running&&!rows.length)return E('span',{});
		var head=st.running?dot('yellow',_('Проверка ')+String(st.current||0)+' / '+String(st.total||0)):((st.state==='done')?dot('green',_('Последняя проверка завершена')):dot('grey',_('Последние сохранённые результаты')));
		var summary=_('Доступны')+' '+String(st.passed||0)+' · '+_('частично')+' '+String(st.reachable||0)+' · '+_('недоступны')+' '+String(st.failed||0);
		var details=E('details',{'open':st.running?'open':null,'style':'max-width:100%;overflow:hidden;'},[E('summary',{'style':'cursor:pointer;font-weight:600;'},_('Маршруты')+' · '+String(rows.length)),E('div',{'style':'margin-top:.45em;min-width:0;'},rows)]);
		var controls=[];if(st.running)controls.push(E('button',{'class':'cbi-button cbi-button-negative','click':ui.createHandlerFn(this,'cancelTelegramQualification')},_('Остановить')));
		return E('div',{'class':'cbi-section pb-card','style':'width:100%;max-width:820px;box-sizing:border-box;overflow:hidden;'},[
			E('h3',{'style':'margin-top:0;'},_('Доступ к Telegram по маршрутам')),
			E('div',{'style':'display:flex;justify-content:space-between;gap:.7em;flex-wrap:wrap;min-width:0;'},[head,E('strong',{'style':'overflow-wrap:anywhere;'},summary)]),
			st.running&&st.endpoint?E('div',{'class':'pb-hint-90','style':'margin-top:.35em;overflow-wrap:anywhere;'},_('Сейчас проверяется: ')+st.endpoint):E('span',{}),details,
			controls.length?E('div',{'style':'margin-top:.55em;'},controls):E('span',{})
		]);
	},

	runCustomProxy: function() {
		var self=this,host=(this._cp.host.value||'').trim(),port=(this._cp.port.value||'').trim(),user=(this._cp.user.value||'').trim(),pass=this._cp.pass.value||'',type=this._cp.type.value||'socks5h';
		if(!host||!/^[0-9]+$/.test(port)||parseInt(port,10)<1||parseInt(port,10)>65535){showFailure(this,_('Проверьте хост и порт.'));return;}
		var auth=user?(encodeURIComponent(user)+(pass?':'+encodeURIComponent(pass):'')+'@'):'',endpoint=type+'://'+auth+host+':'+port,label=type+'://'+(user?user+':***@':'')+host+':'+port;
		this.runBtn.disabled=true;this.beginProgress(_('Проверка ручного прокси'),_('Фоновая проверка · география + 12 сервисов + скорость'));
		return asyncProbe('',endpoint,label,false).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){showFailure(self,_('Проверка прокси не завершилась: ')+((e&&e.message)||'?'));}).finally(function(){self.runBtn.disabled=false;});
	},

	enableMixedProxy: function(section) {
		var self=this;
		return callEnsureMixedProxy(section).then(function(r){
			if(!(r&&(r.ok||r.already_enabled)))throw new Error((r&&r.reason)||'enable_failed');
			self.beginProgress(_('Проверка секции '+section),_('Фоновая проверка · география + 12 сервисов + скорость'));
			return asyncProbe(section,'','',false);
		}).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){showFailure(self,_('Ошибка включения/проверки Mixed Proxy: ')+((e&&e.message)||'?'));});
	},

	nextWarpTestRoute: function() {
		var self=this,items=this.warpItems||[];this.syncSelectedTarget();if(!this.selectedWarp||items.length<2)return;
		var current=this.currentWarpEndpoint(),idx=-1;items.some(function(x,i){if(x.endpoint===current){idx=i;return true;}return false;});
		var ep=items[(idx+1+items.length)%items.length].endpoint;if(this.warpNextBtn)this.warpNextBtn.disabled=true;
		this.beginProgress(_('Проверка следующего WARP'),_('Этап 1/3 · запускаю тестовый SOCKS · ')+ep);
		return this.ensureWarpTestRoute(ep).then(function(rt){
			self.setProgress(_('Этап 2/3 · фоновая проверка сервисов и скорости'));
			return asyncProbe('',(rt&&rt.proxy)||'socks5h://127.0.0.1:18191',_('WARP · ')+ep,true);
		}).then(function(d){
			self.setProgress(_('Этап 3/3 · проверяю восстановление ON-AIR WARP Rescue'));
			return self.stopWarpTestRoute().catch(function(){return null;}).then(function(){return d;});
		}).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){
			self.setProgress(_('Проверяю восстановление WARP Rescue после ошибки…'));
			return self.stopWarpTestRoute().catch(function(){}).then(function(){showFailure(self,_('Проверка WARP не завершилась: ')+((e&&e.message)||'?'));});
		}).finally(function(){if(self.warpNextBtn)self.warpNextBtn.disabled=false;});
	},

	runProbe: function() {
		var self=this;this.runBtn.disabled=true;if(this.batchBtn)this.batchBtn.disabled=true;this.syncSelectedTarget();
		if(this.selectedWarp){
			var ep=this.currentWarpEndpoint();this.beginProgress(_('Проверка ON-AIR WARP'),_('Этап 1/3 · запускаю тестовый SOCKS · ')+ep);
			return this.ensureWarpTestRoute(ep).then(function(rt){self.setProgress(_('Этап 2/3 · фоновая проверка сервисов и скорости'));return asyncProbe('',(rt&&rt.proxy)||'socks5h://127.0.0.1:18191',_('WARP Rescue · ')+ep,true);}).then(function(d){self.setProgress(_('Этап 3/3 · проверяю восстановление ON-AIR WARP Rescue'));return self.stopWarpTestRoute().catch(function(){return null;}).then(function(){return d;});}).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){return self.stopWarpTestRoute().catch(function(){}).then(function(){showFailure(self,_('Проверка WARP не завершилась: ')+((e&&e.message)||'?'));});}).finally(function(){self.runBtn.disabled=false;if(self.batchBtn)self.batchBtn.disabled=false;});
		}
		var usingProxy=!!this.selectedProxy,sec=usingProxy?'':(this.selectedSection||''),prox=usingProxy?this.selectedProxy:'',lbl=usingProxy?(this.selectedProxyLabel||''):'';
		this.beginProgress(usingProxy?_('Проверка прокси'):_('Проверка секции '+sec),_('Фоновая проверка · география + 12 сервисов + скорость'));
		return asyncProbe(sec,prox,lbl,false).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){showFailure(self,_('Проверка не завершилась: ')+((e&&e.message)||'?'));}).finally(function(){self.runBtn.disabled=false;if(self.batchBtn)self.batchBtn.disabled=false;});
	},

	runAllProbes: function() {
		var self=this;if(!window.confirm(_('Полная проверка всех маршрутов может выполняться до 90 секунд при большом числе прокси и заметно нагружает роутер. Продолжить?')))return Promise.resolve();
		this.runBtn.disabled=true;if(this.batchBtn)this.batchBtn.disabled=true;
		var probeable=this.sections.filter(function(s){return s.enabled_for_runtime;}),results=[],tasks=[],total=probeable.length+(this.tierProxies||[]).length+(this.warpRouteReady?1:0),n=0,chain=Promise.resolve();
		probeable.forEach(function(s){tasks.push({type:'section',label:s.name,run:function(){return asyncProbe(s.name,'','',false);}});});
		(this.tierProxies||[]).forEach(function(p){tasks.push({type:'proxy',label:p.label,run:function(){return asyncProbe('',p.endpoint,p.label,false);}});});
		if(this.warpRouteReady)tasks.push({type:'warp',label:_('WARP Rescue · WARPSCOUT'),run:function(){var ep=self.currentWarpEndpoint();return self.ensureWarpTestRoute(ep).then(function(rt){return asyncProbe('',(rt&&rt.proxy)||'socks5h://127.0.0.1:18191',_('WARP Rescue · ')+ep,true);}).then(function(d){return self.stopWarpTestRoute().catch(function(){return null;}).then(function(){return d;});});}});
		this.beginProgress(_('Проверка всех маршрутов'),_('Подготовка · всего ')+total);
		tasks.forEach(function(t){chain=chain.then(function(){n++;self.setProgress(_('Маршрут ')+n+' / '+total+' · '+t.label+' · '+_('фоновая проверка'));return t.run().then(function(d){results.push({sec:t.label,d:d,type:t.type});}).catch(function(e){if(t.type==='warp')return self.stopWarpTestRoute().catch(function(){}).then(function(){results.push({sec:t.label,d:null,type:t.type,reason:(e&&e.message)||'warp_test_failed'});});results.push({sec:t.label,d:null,type:t.type,reason:(e&&e.message)||'rpc_error'});});});});
		return chain.then(function(){self.endProgress();dom.content(self.body,self.renderBatch(results));}).finally(function(){self.endProgress();self.runBtn.disabled=false;if(self.batchBtn)self.batchBtn.disabled=false;});
	}
});

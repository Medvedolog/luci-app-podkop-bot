'use strict';
'require view.podkop-bot.overview as base';
'require rpc';
'require ui';
'require dom';

var callProbeStart = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_start', params:['section','proxy','label','restore_warp'] });
var callProbeStatus = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_status' });
var callProbeResult = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_result' });
var callBearholeStatus = rpc.declare({ object:'podkop_bot_bearhole', method:'status' });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });
var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
var ONBOARDING_KEY='podkop-bot.setup-wizard-shown.v1';
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}
function rrow(label,value){return E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},label),E('span',{'class':'pb-row-val'},value instanceof Node?value:String(value==null?'—':value))]);}
function runProbe(){
	return callProbeStart('','','Обзор','false').then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'probe_start_failed');return new Promise(function(resolve,reject){var fail=0;function tick(){callProbeStatus().then(function(st){fail=0;if(st&&st.running){window.setTimeout(tick,1400);return;}callProbeResult().then(resolve).catch(reject);}).catch(function(e){fail++;if(fail<20){window.setTimeout(tick,1800);return;}reject(e);});}tick();});});
}
function shouldOpenWizard(data){return !!(data&&data.available===false&&(data.reason==='bot_not_installed'||data.reason==='installer_missing'));}

/* LuCI require() injects dependency *instances*, not constructors. The old
 * wrapper returned the imported overview instance directly, so the loader
 * rejected it with "factory yields invalid constructor". */
return base.constructor.extend({
	render:function(data){
		if(shouldOpenWizard(data)){
			var shown=false;
			try{shown=window.sessionStorage&&sessionStorage.getItem(ONBOARDING_KEY)==='1';}catch(e){}
			if(!shown){
				try{if(window.sessionStorage)sessionStorage.setItem(ONBOARDING_KEY,'1');}catch(e){}
				window.setTimeout(function(){window.location=L.url('admin/services/podkop-bot/settings/wizard');},0);
				return E('div',{'class':'cbi-section'},[E('p',{'class':'spinning'},_('Podkop Bot ещё не настроен. Открываю мастер настройки…'))]);
			}
		}
		return base.render.call(this,data);
	},

	/* Keep the Overview resource card about processes and memory only. WARP
	 * process details moved here from the WARP card, and HWELP is surfaced next
	 * to sing-box so there is one place to see what consumes RAM. */
	buildResources:function(r){
		if(!r||r.ok===false)return E('div',{'class':'cbi-section','style':'max-width:600px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;'},[E('h3',{'style':'margin-top:0;'},_('Ресурсы')),rrow(_('Состояние'),dot('grey',_('недоступно')))]);
		var sb=r.singbox||{},ram=r.ram||{};
		var sbNode=sb.running?dot('green',_('работает')+' · PID '+((sb.pids&&sb.pids.length)?sb.pids.join(', '):'?')+(sb.count>1?(' ('+sb.count+')'):'')+' · RSS '+(sb.rss_mb!=null?sb.rss_mb:'?')+' MB'):dot('red',_('не запущен'));
		var ramColour=(ram.avail_mb!=null&&ram.avail_mb<60)?'yellow':'green';
		var ramNode=dot(ramColour,(ram.avail_mb!=null?ram.avail_mb:'?')+' / '+(ram.total_mb!=null?ram.total_mb:'?')+' MB '+_('свободно')+(ram.used_pct!=null?(' · '+ram.used_pct+'% занято'):''));
		var hwelpCell=E('span',{},dot('grey',_('проверяю…'))),warpCell=E('span',{},dot('grey',_('проверяю…')));
		var box=E('div',{'class':'cbi-section','style':'max-width:600px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;'},[E('h3',{'style':'margin-top:0;'},_('Ресурсы')),rrow('sing-box',sbNode),rrow('hwelp proxy',hwelpCell),rrow(_('WARP Rescue'),warpCell),rrow(_('Оперативная память'),ramNode)]);
		Promise.all([callBearholeStatus().catch(function(){return null;}),callRescueStatus().catch(function(){return null;})]).then(function(v){
			var bh=v[0],wr=v[1];
			if(!bh||bh.ok===false)dom.content(hwelpCell,dot('grey',_('недоступно')));
			else if(!bh.hwelp_installed)dom.content(hwelpCell,dot('grey',_('не установлен')));
			else if(bh.running){var hs=_('работает')+(bh.pid?(' · PID '+bh.pid):'')+(bh.hwelp_rss_mb!=null?(' · RSS '+bh.hwelp_rss_mb+' MB'):'');dom.content(hwelpCell,dot('green',hs));}
			else dom.content(hwelpCell,dot('grey',_('установлен, не запущен')));
			if(!wr)dom.content(warpCell,dot('grey',_('недоступно')));
			else if(wr.running){var ws=_('работает')+(wr.pid?(' · PID '+wr.pid):'')+(wr.rss_mb!=null?(' · RSS '+wr.rss_mb+' MB'):'');dom.content(warpCell,dot('green',ws));}
			else dom.content(warpCell,dot('grey',_('не запущен')));
		});
		return box;
	},

	/* Detailed endpoint/latency/magazine data already lives on Transport. On the
	 * Overview only answer the two operational questions that matter. */
	buildWarpStatus:function(ws,rescue){
		if(!ws||!ws.installed)return E('span',{});
		var running=!!(rescue&&rescue.running),auto=!!(rescue&&rescue.auto),busy=!!(rescue&&rescue.busy);
		var state=running?dot('green',_('работает')):(busy?dot('yellow',_('запускается / переключается')):dot('grey',_('не работает')));
		return E('div',{'class':'cbi-section','style':'max-width:600px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;margin-top:1em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));'},[
			E('h3',{'style':'margin-top:0;'},_('WARP Rescue')),
			rrow(_('Состояние'),state),
			rrow(_('Автозапуск револьвера'),auto?dot('green',_('включён')):dot('grey',_('выключен'))),
			E('div',{'style':'margin-top:.7em;'},[E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/transport/warp-revolver')},_('Открыть револьвер WARP'))])
		]);
	},

	handleOutboundProbe:function(){
		ui.showModal(_('Полный тест Outbound'),[E('p',{'class':'spinning'},_('Проверка запущена на роутере. Страницу можно кратковременно потерять — тест продолжится в фоне.'))]);
		return runProbe().then(function(d){
			if(!d||d.available===false){ui.showModal(_('Полный тест Outbound'),[E('p',{},dot('yellow',(d&&d.detail)?d.detail:_('Проверка недоступна.'))),E('div',{'class':'right'},[E('button',{'class':'btn','click':ui.hideModal},_('Закрыть'))])]);return;}
			var svc=(d.services||[]).map(function(x){var c=x.status==='ok'?'green':((x.status==='blocked'||x.status==='timeout')?'red':'yellow'),tail=(x.ms?(' · '+x.ms+' ms'):'')+(x.geo?(' · '+x.geo):'')+(x.code&&x.code!=='000'?(' · HTTP '+x.code):'');return E('div',{'style':'margin:.2em 0;'},dot(c,(x.name||'?')+tail));}),sp=d.speed||{},spc=sp.status==='ok'?'green':'red';
			ui.showModal(_('Полный тест Outbound'),[E('p',{},[E('strong',{},_('Выход: ')),(d.geo&&d.geo.ip?d.geo.ip:'—')+(d.geo&&d.geo.country?(' · '+d.geo.country):'')]),E('div',{'style':'max-height:45vh;overflow:auto;margin:.5em 0;'},svc),E('p',{},dot(spc,_('Скорость: ')+(sp.mbps||'0')+' Mbit/s · '+(sp.status||'unknown'))),E('div',{'class':'right'},[E('button',{'class':'cbi-button','click':function(){window.location=L.url('admin/services/podkop-bot/runtime/services');}},_('Открыть проверку маршрутов')),' ',E('button',{'class':'btn','click':ui.hideModal},_('Закрыть'))])]);
		}).catch(function(e){ui.showModal(_('Полный тест Outbound'),[E('p',{},dot('red',_('Проверка не завершилась: ')+((e&&e.message)||'?'))),E('div',{'class':'right'},[E('button',{'class':'btn','click':ui.hideModal},_('Закрыть'))])]);});
	}
});

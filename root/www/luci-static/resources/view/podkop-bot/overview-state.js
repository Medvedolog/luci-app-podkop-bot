'use strict';
'require view.podkop-bot.overview-async as base';
'require rpc';
'require dom';

var callBearholeStatus = rpc.declare({ object:'podkop_bot_bearhole', method:'status' });

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}
function rrow(label,value){return E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},label),E('span',{'class':'pb-row-val'},value instanceof Node?value:String(value==null?'—':value))]);}

function hwelpNode(bh){
	if(!bh)return dot('grey',_('—'));
	if(bh.ok===false)return dot('grey',_('недоступно'));
	if(!bh.hwelp_installed)return dot('grey',_('не установлен'));
	if(bh.running){var s=_('работает')+(bh.pid?(' · PID '+bh.pid):'')+(bh.hwelp_rss_mb!=null?(' · RSS '+bh.hwelp_rss_mb+' MB'):'');return dot('green',s);}
	return dot('grey',_('установлен, не запущен'));
}
function rescueNode(wr){
	if(!wr)return dot('grey',_('—'));
	if(wr.running){var s=_('работает')+(wr.pid?(' · PID '+wr.pid):'')+(wr.rss_mb!=null?(' · RSS '+wr.rss_mb+' MB'):'');return dot('green',s);}
	return dot('grey',_('не запущен'));
}

function suppressUnknownVersionMarker(){
	var cell=document.getElementById('podkop-ver-cell');
	if(!cell)return;
	function clean(){
		var spans=cell.querySelectorAll('span');
		for(var i=0;i<spans.length;i++){
			if((spans[i].textContent||'').trim()==='?')spans[i].remove();
		}
	}
	clean();
	var obs=new MutationObserver(clean);
	obs.observe(cell,{childList:true,subtree:true});
	window.setTimeout(function(){obs.disconnect();clean();},15000);
}

return base.constructor.extend({
	render:function(data){
		var node=base.render.call(this,data);
		window.setTimeout(suppressUnknownVersionMarker,0);
		return node;
	},

	buildResources:function(r){
		if(!r||r.ok===false)return E('div',{'class':'cbi-section','style':'max-width:600px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;'},[E('h3',{'style':'margin-top:0;'},_('Ресурсы')),rrow(_('Состояние'),dot('grey',_('недоступно')))]);
		var sb=r.singbox||{},ram=r.ram||{};
		var sbNode=sb.running?dot('green',_('работает')+' · PID '+((sb.pids&&sb.pids.length)?sb.pids.join(', '):'?')+(sb.count>1?(' ('+sb.count+')'):'')+' · RSS '+(sb.rss_mb!=null?sb.rss_mb:'?')+' MB'):dot('red',_('не запущен'));
		var ramColour=(ram.avail_mb!=null&&ram.avail_mb<60)?'yellow':'green';
		var ramNode=dot(ramColour,(ram.avail_mb!=null?ram.avail_mb:'?')+' / '+(ram.total_mb!=null?ram.total_mb:'?')+' MB '+_('свободно')+(ram.used_pct!=null?(' · '+ram.used_pct+'% занято'):''));
		var hwelpCell=E('span',{},hwelpNode(this._lastBearholeStatus||null));
		var warpCell=E('span',{},rescueNode(this._lastRescueStatus||null));
		var box=E('div',{'class':'cbi-section','style':'max-width:600px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;'},[E('h3',{'style':'margin-top:0;'},_('Ресурсы')),rrow('sing-box',sbNode),rrow('hwelp proxy',hwelpCell),rrow(_('WARP Rescue'),warpCell),rrow(_('Оперативная память'),ramNode)]);
		var self=this;
		callBearholeStatus().catch(function(){return null;}).then(function(bh){
			self._lastBearholeStatus=bh;
			dom.content(hwelpCell,hwelpNode(bh));
		});
		return box;
	}
});

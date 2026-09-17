'use strict';
'require view.podkop-bot.runtime-services as base';
'require dom';

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:center;gap:.35em;min-width:0;'},[E('span',{'style':'width:.65em;height:.65em;border-radius:50%;display:inline-block;flex:none;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{'style':'min-width:0;overflow-wrap:anywhere;'},label)]);}
function serviceColour(s){if(!s)return 'grey';if(s.status==='ok')return 'green';if(s.status==='blocked')return 'yellow';if(s.status==='fail'||s.status==='error'||s.status==='timeout')return 'red';return 'grey';}
function serviceLabel(s){if(!s)return '—';var p=[];if(s.code&&s.code!=='000')p.push(String(s.code));if(s.ms>0)p.push(String(s.ms)+' ms');return p.length?p.join(' · '):(s.status||'—');}
function normEndpoint(s){return String(s||'').replace(/^socks5h?:\/\//,'').replace(/#.*$/,'').replace(/^[^@]*@/,'');}

return base.constructor.extend({
	render:function(data){
		if(data&&data[9]&&data[9].running&&data[4]&&data[4].items&&data[4].items.length){
			data[3]=data[3]||{};
			data[3].installed=true;
			data[3].account_ready=true;
		}
		return base.render.call(this,data);
	},

	beginProgress:function(title,stage){
		var self=this;this.endProgress();this.progressStarted=Date.now();this.progressTitle=title;this.progressStage=stage;
		this.progressDraw=function(){
			var sec=Math.max(0,Math.floor((Date.now()-self.progressStarted)/1000));
			var pos=(sec*7)%100;
			dom.content(self.body,E('div',{'class':'cbi-section pb-wide'},[
				dot('yellow',self.progressTitle),
				E('div',{'style':'height:6px;background:rgba(127,127,127,.18);border-radius:4px;overflow:hidden;margin:.65em 0 .45em;'},[
					E('div',{'style':'height:100%;width:28%;border-radius:4px;background:#e8a33d;transform:translateX('+Math.max(-28,pos-14)+'%);transition:transform .8s linear;'})
				]),
				E('div',{'class':'pb-hint-90'},self.progressStage+' · '+_('прошло ')+sec+_(' с'))
			]));
		};
		this.progressDraw();this.progressTimer=window.setInterval(this.progressDraw,1000);
	},

	renderBatch:function(results){
		var names=[],seenNames={},seenEndpoints={},filtered=[];
		(results||[]).forEach(function(r){
			var d=r&&r.d||{},ep=normEndpoint(d.endpoint||d.proxy_human||'');
			if(ep&&seenEndpoints[ep])return;
			if(ep)seenEndpoints[ep]=1;
			filtered.push(r);
			((d.services)||[]).forEach(function(s){if(s&&s.name&&!seenNames[s.name]){seenNames[s.name]=1;names.push(s.name);}});
		});
		var head=[E('th',{'style':'text-align:left;position:sticky;left:0;background:var(--background-color-high,var(--background-color,#222));z-index:2;min-width:165px;'},_('Маршрут'))];
		names.forEach(function(n){head.push(E('th',{'style':'text-align:center;min-width:105px;white-space:normal;'},n));});
		head.push(E('th',{'style':'text-align:right;min-width:85px;'},_('Скорость')));
		var rows=filtered.map(function(r){
			if(!r.d||r.d.available===false){var why=(r.d&&(r.d.reason||r.d.detail))||r.reason||_('нет результата');return E('tr',{},[E('td',{'style':'position:sticky;left:0;background:var(--background-color-high,var(--background-color,#222));z-index:1;font-weight:600;'},r.sec),E('td',{'colspan':String(names.length+1)},dot(r.d&&r.d.available===false?'yellow':'red',why))]);}
			var d=r.d,by={};(d.services||[]).forEach(function(s){if(s&&s.name)by[s.name]=s;});
			var label=r.type==='warp'?_('WARP Rescue'):String(r.sec||'').replace(/\s+—\s+.*$/,'');
			var cells=[E('td',{'style':'position:sticky;left:0;background:var(--background-color-high,var(--background-color,#222));z-index:1;font-weight:600;max-width:210px;overflow-wrap:anywhere;'},label)];
			names.forEach(function(n){var s=by[n],tip='';if(s)tip=[s.status||'',s.code&&s.code!=='000'?('HTTP '+s.code):'',s.ms>0?(s.ms+' ms'):'',s.geo||''].filter(Boolean).join(' · ');cells.push(E('td',{'style':'text-align:center;vertical-align:middle;','title':tip},dot(serviceColour(s),serviceLabel(s))));});
			var sp=d.speed||{},speed=sp.mbps?sp.mbps+' Mbps':(sp.status||'—');cells.push(E('td',{'style':'text-align:right;white-space:nowrap;'},speed));return E('tr',{},cells);
		});
		return E('div',{'class':'cbi-section pb-card','style':'max-width:100%;'},[
			E('h3',{'style':'margin-top:0;'},_('Матрица сервисов по маршрутам')),
			E('p',{'class':'pb-hint-90','style':'margin-top:0;'},_('Одна строка — один маршрут. Адреса прокси и IP выхода скрыты; подробности доступны в одиночной проверке.')),
			E('div',{'style':'overflow-x:auto;max-width:100%;'},[E('table',{'class':'table','style':'width:max-content;min-width:100%;border-collapse:collapse;'},[E('thead',{},E('tr',{},head)),E('tbody',{},rows)])])
		]);
	}
});

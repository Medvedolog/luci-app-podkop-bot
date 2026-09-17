'use strict';
'require view.podkop-bot.runtime-async as base';
'require ui';

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:center;gap:.35em;min-width:0;'},[E('span',{'style':'width:.65em;height:.65em;border-radius:50%;display:inline-block;flex:none;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{'style':'min-width:0;overflow-wrap:anywhere;'},label)]);}
function ageText(ts){var n=parseInt(ts||0,10);if(!n)return '—';var s=Math.max(0,Math.floor(Date.now()/1000)-n);if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');}
function tgStatusNode(x){var s=x&&x.status||'';if(s==='VALID')return dot('green','VALID');if(s.indexOf('REACHABLE_')===0)return dot('yellow',s.replace('REACHABLE_',''));if(s==='FAIL')return dot('red','FAIL');return dot('grey',_('ОЖИДАЕТ'));}
function serviceColour(s){if(!s)return 'grey';if(s.status==='ok')return 'green';if(s.status==='blocked')return 'yellow';if(s.status==='fail'||s.status==='error'||s.status==='timeout')return 'red';return 'grey';}
function serviceLabel(s){if(!s)return '—';var parts=[];if(s.code&&s.code!=='000')parts.push(String(s.code));if(s.ms>0)parts.push(String(s.ms)+' ms');return parts.length?parts.join(' · '):(s.status||'—');}

return base.constructor.extend({
	renderBatch:function(results){
		var self=this,names=[],seen={};
		(results||[]).forEach(function(r){
			((r.d&&r.d.services)||[]).forEach(function(s){if(s&&s.name&&!seen[s.name]){seen[s.name]=1;names.push(s.name);}});
		});
		var head=[E('th',{'style':'text-align:left;position:sticky;left:0;background:var(--background-color-high,var(--background-color,#222));z-index:2;min-width:190px;'},_('Маршрут')),E('th',{'style':'text-align:left;min-width:145px;'},_('Выход'))];
		names.forEach(function(n){head.push(E('th',{'style':'text-align:center;min-width:105px;white-space:normal;'},n));});
		head.push(E('th',{'style':'text-align:right;min-width:85px;'},_('Скорость')));
		var rows=(results||[]).map(function(r){
			if(!r.d||r.d.available===false){
				var why=(r.d&&(r.d.reason||r.d.detail))||r.reason||_('нет результата');
				return E('tr',{},[E('td',{'style':'position:sticky;left:0;background:var(--background-color-high,var(--background-color,#222));z-index:1;font-weight:600;'},r.sec),E('td',{'colspan':String(names.length+2)},dot(r.d&&r.d.available===false?'yellow':'red',why))]);
			}
			var d=r.d,g=d.geo||{},by={};((d.services)||[]).forEach(function(s){if(s&&s.name)by[s.name]=s;});
			var cells=[E('td',{'style':'position:sticky;left:0;background:var(--background-color-high,var(--background-color,#222));z-index:1;font-weight:600;max-width:260px;overflow-wrap:anywhere;'},r.sec),E('td',{'style':'white-space:normal;'},[(g.country||'—'),g.ip?E('div',{'style':'color:#888;font-size:82%;'},g.ip):E('span',{})])];
			names.forEach(function(n){var s=by[n],tip='';if(s){tip=[s.status||'',s.code&&s.code!=='000'?('HTTP '+s.code):'',s.ms>0?(s.ms+' ms'):'',s.geo||''].filter(Boolean).join(' · ');}cells.push(E('td',{'style':'text-align:center;vertical-align:middle;','title':tip},dot(serviceColour(s),serviceLabel(s))));});
			var sp=d.speed||{},speed=sp.mbps?sp.mbps+' Mbps':(sp.status||'—');cells.push(E('td',{'style':'text-align:right;white-space:nowrap;'},speed));
			return E('tr',{},cells);
		});
		return E('div',{'class':'cbi-section pb-card','style':'max-width:100%;'},[
			E('h3',{'style':'margin-top:0;'},_('Матрица сервисов по маршрутам')),
			E('p',{'class':'pb-hint-90','style':'margin-top:0;'},_('Показаны все сервисы полной диагностики. В ячейке — HTTP-код и задержка; полный статус доступен по наведению.')),
			E('div',{'style':'overflow-x:auto;max-width:100%;'},[E('table',{'class':'table','style':'width:max-content;min-width:100%;border-collapse:collapse;'},[E('thead',{},E('tr',{},head)),E('tbody',{},rows)])])
		]);
	},

	renderTgSummary:function(){
		var self=this,st=this.tgScanStatus||{},res=(this.tgScanResults&&this.tgScanResults.items)||[],plan=(this.tgScanPlan&&this.tgScanPlan.items)||[],byKey={};
		res.forEach(function(x){byKey[(x.source_id||'')+'|'+(x.endpoint||'')]=x;});
		var rows=(plan.length?plan:res).map(function(p,i){
			var x=byKey[(p.source_id||'')+'|'+(p.endpoint||'')]||p,checking=st.running&&parseInt(st.current||0,10)===i+1&&!x.status,status=checking?dot('yellow',_('ПРОВЕРЯЕТСЯ')):tgStatusNode(x),tags=self.tgUsageTags(x),meta=[];
			if(x.latency_ms)meta.push(_('Задержка TG ')+x.latency_ms+' мс');if(x.http)meta.push('HTTP '+x.http);if(x.provider==='warp'&&(x.node||x.node_location))meta.push((x.node||'—')+' · '+(x.node_location||'—'));if(x.loss)meta.push(_('Потери ')+x.loss);if(x.checked_at)meta.push(ageText(x.checked_at));
			return E('div',{'style':'border-top:1px solid rgba(127,127,127,.14);padding:.55em 0;min-width:0;'},[E('div',{'style':'display:flex;justify-content:space-between;gap:.65em;align-items:flex-start;flex-wrap:wrap;min-width:0;'},[E('div',{'style':'min-width:0;flex:1 1 300px;'},[E('strong',{'style':'display:block;overflow-wrap:anywhere;'},x.label||x.source_id||(_('маршрут ')+(i+1))),x.endpoint?E('code',{'style':'display:block;color:#888;margin-top:.15em;white-space:normal;overflow-wrap:anywhere;word-break:break-word;'},x.endpoint):E('span',{})]),E('div',{'style':'display:flex;gap:.35em;align-items:center;flex-wrap:wrap;flex:0 1 auto;max-width:100%;'},tags.map(function(z){return E('span',{'class':'label'},z);}).concat([status]))]),meta.length?E('div',{'class':'pb-hint-90','style':'margin-top:.25em;overflow-wrap:anywhere;'},meta.join(' · ')):E('span',{})]);
		});
		if(!st.running&&!rows.length)return E('span',{});
		if(st.running)this._tgDetailsOpen=true;
		if(this._tgDetailsOpen==null)this._tgDetailsOpen=true;
		var head=st.running?dot('yellow',_('Проверка ')+String(st.current||0)+' / '+String(st.total||0)):((st.state==='done')?dot('green',_('Последняя проверка завершена')):dot('grey',_('Последние сохранённые результаты')));
		var summary=_('Доступны')+' '+String(st.passed||0)+' · '+_('частично')+' '+String(st.reachable||0)+' · '+_('недоступны')+' '+String(st.failed||0);
		var details=E('details',{'open':this._tgDetailsOpen?'open':null,'style':'max-width:100%;overflow:hidden;','toggle':function(){self._tgDetailsOpen=!!this.open;}},[E('summary',{'style':'cursor:pointer;font-weight:600;'},_('Маршруты')+' · '+String(rows.length)),E('div',{'style':'margin-top:.45em;min-width:0;'},rows)]);
		var controls=[];if(st.running)controls.push(E('button',{'class':'cbi-button cbi-button-negative','click':ui.createHandlerFn(this,'cancelTelegramQualification')},_('Остановить')));
		return E('div',{'class':'cbi-section pb-card','style':'width:100%;max-width:1080px;box-sizing:border-box;overflow:hidden;'},[E('h3',{'style':'margin-top:0;'},_('Доступ к Telegram по маршрутам')),E('div',{'style':'display:flex;justify-content:space-between;gap:.7em;flex-wrap:wrap;min-width:0;'},[head,E('strong',{'style':'overflow-wrap:anywhere;'},summary)]),st.running&&st.endpoint?E('div',{'class':'pb-hint-90','style':'margin-top:.35em;overflow-wrap:anywhere;'},_('Сейчас проверяется: ')+st.endpoint):E('span',{}),details,controls.length?E('div',{'style':'margin-top:.55em;'},controls):E('span',{})]);
	}
});

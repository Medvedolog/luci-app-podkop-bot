'use strict';
'require view.podkop-bot.runtime-live as base';

/* Service diagnostics stay focused on the heavy full-route probe.
 * Telegram qualification has its own Runtime subtab. */
return base.constructor.extend({
	renderTgSummary:function(){
		return E('span',{});
	},

	render:function(data){
		var root=base.render.call(this,data);
		if(this.tgBtn)this.tgBtn.style.display='none';
		return root;
	},

	hydrateRuntime:function(seed,root){
		var self=this;
		return base.hydrateRuntime.call(this,seed,root).then(function(){
			if(self.tgBtn)self.tgBtn.style.display='none';
		});
	}
});

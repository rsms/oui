/** OUI additions */

jQuery.fn.centerOnScreen = function(phix) {
	if (phix === undefined) phix = 1;
	var minTopMargin = 10, minLeftMargin = 10;
	return this.each(function(){
		var q = jQuery(this);
		var p = {
			left: Math.max(Math.ceil((window.innerWidth - q.width())/2), minLeftMargin),
			top: Math.max(Math.ceil((window.innerHeight - q.height())/2), minTopMargin)
		};
		if (phix)
			p.top = Math.ceil(p.top / 1.61803399);
		q.css(p);
	});
};

jQuery.fn.fillScreen = function() {
	return this.css({left:0,top:0}).width(window.innerWidth).height(window.innerHeight);
};

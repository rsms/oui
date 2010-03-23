var tree = require('../tree');

tree.Alpha = function Alpha(val) {
    this.value = val;
};
tree.Alpha.prototype = {
    toCSS: function () {
        return "alpha(opacity=" + (this.value.toCSS ? this.value.toCSS() : this.value) + ")";
    }
};

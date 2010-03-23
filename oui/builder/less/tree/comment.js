var tree = require('../tree');

tree.Comment = function Comment(value) {
    this.value = value;
};
tree.Comment.prototype = {
    toCSS: function () {
        return this.value;
    }
};

'use strict';
define({
  hasClass: function(node, name) {
    return node && node.classList.contains(name);
  },

  addClass: function(node, name) {
    return node && node.classList.add(name);
  },

  removeClass: function(node, name) {
    return node && node.classList.remove(name);
  }
});

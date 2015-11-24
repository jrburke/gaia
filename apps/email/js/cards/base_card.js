define(function(require) {
  'use strict';

  var base = require('./base');

  return function baseCard(templateMixins) {
    // Set up the base mixin
    return [
      base(templateMixins),
      require('./mixins/extra_classes'),
      require('./mixins/onback'),
      {
        batchAddClass: function(searchClass, classToAdd) {
          var nodes = this.getElementsByClassName(searchClass);
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.add(classToAdd);
          }
        }
      }
    ];
  };
});

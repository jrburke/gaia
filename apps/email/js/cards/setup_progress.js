'use strict';
define(function(require) {

var cards = require('cards');

return [
  require('./base_card')(require('template!./setup_progress.html')),
  {
    extraClasses: ['anim-fade', 'anim-overlay'],

    onBack: function(e) {
      if (e) {
        e.preventDefault();
      }
      this.args.setupController.cancel();
      cards.back('animate');
    },

    release: function() {
    }
  }
];
});

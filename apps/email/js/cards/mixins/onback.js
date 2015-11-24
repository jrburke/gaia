define(function() {
  'use strict';
  var cards = require('cards');

  return {
    onBack: function(event) {
      if (event) {
        event.preventDefault();
      }
      cards.back('animate');
    }
  };
});

define(function(require) {
  'use strict';
  var date = require('date'),
      mozL10n = require('l10n!');

  // Set up the global time updates for all nodes.
  (function() {
    var updatePrettyDate = function updatePrettyDate() {
      var labels = [...document.querySelectorAll('[data-time]')];
      labels.forEach(label => {
        date.relativeDateElement(label, label.dataset.time);
      });
    };
    var timer = setInterval(updatePrettyDate, 60 * 1000);

    function updatePrettyDateOnEvent() {
      clearInterval(timer);
      updatePrettyDate();
      timer = setInterval(updatePrettyDate, 60 * 1000);
    }
    // When user changes the language, update timestamps.
    mozL10n.ready(updatePrettyDateOnEvent);

    // On visibility change to not hidden, update timestamps
    document.addEventListener('visibilitychange', function() {
      if (document && !document.hidden) {
        updatePrettyDateOnEvent();
      } else {
        // If not visible, clear the interval to be a battery good citizen.
        clearInterval(timer);
      }
    });

  })();
})

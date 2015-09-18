'use strict';
define(function(require) {
  var evt = require('evt'),
      hookupInputAreaResetButtons = require('input_areas'),
      htmlCache = require('html_cache'),
      setStatusColor = require('set_status_color');

  return function cardsInit(cards) {
    // Handle cases where a default card is needed for back navigation
    // after a non-default entry point (like an activity) is triggered.
    cards.insertDefaultCard = function() {
      return new Promise(function(resolve, reject) {
        // Dynamically require model_create, so that cards init does not depend
        // explicitly on the model, just use it if a default card is needed.
        require(['model_create'], function(modelCreate) {
          cards.insert('message_list', {
            model: modelCreate.defaultModel
          }, 'previous').then(resolve);
        }, reject);
      });
    };

    cards.elementToType = function(element) {
      return htmlCache.nodeToKey(element);
    };

    cards.typeToModuleId = function(type) {
      return 'element!cards/' + type;
    };

    cards.on('cardCreated', function(type, element) {
      console.log('card created for type: ' + type);
    });

    cards.on('endCardChosen', function(element) {
      // Do the status bar color work before triggering transitions, otherwise
      // we lose some animation frames on the card transitions.
      setStatusColor(element);
    });

    cards.on('postInsert', function(element) {
      // If the card has any <button type="reset"> buttons,
      // make them clear the field they're next to and not the entire form.
      // See input_areas.js and shared/style/input_areas.css.
      hookupInputAreaResetButtons(element);

      // Only do auto font size watching for cards that do not have more
      // complicated needs, like message_list, which modifies children contents
      // that are not caught by the font_size_util.
      if (!element.callHeaderFontSize) {
        // We're appending new elements to DOM so to make sure headers are
        // properly resized and centered, we emit a lazyload event.
        // This will be removed when the gaia-header web component lands.
        window.dispatchEvent(new CustomEvent('lazyload', {
          detail: element
        }));
      }
    });


    // Handle the window.performance stuff on the first card visible event.
    cards.once('cardVisible', function(element) {
      if (window.startupCacheEventsSent) {
        // Cache already loaded, so at this point the content shown is wired
        // to event handlers.
        window.performance.mark('contentInteractive');
      } else {
        // Cache was not used, so only now is the chrome dom loaded.
        window.performance.mark('navigationLoaded');
      }
      window.performance.mark('navigationInteractive');

      // If a card that has a simple static content DOM, content is complete.
      // Otherwise, like message_list, need backend data to call complete.
      if (!element.skipEmitContentEvents) {
        evt.emit('metrics:contentDone');
      }
    });
  };
});

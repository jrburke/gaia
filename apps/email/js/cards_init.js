'use strict';
define(function(require) {
  var evt = require('evt'),
      hookupInputAreaResetButtons = require('input_areas'),
      htmlCache = require('html_cache');

  return function cardsInit(cards) {
    var statusColorMeta = document.querySelector('meta[name="theme-color"]');

    /**
     * Sets the status bar color. The element, or any of its children, can
     * specify the color by setting data-statuscolor to one of the following
     * values:
     * - default: uses the default data-statuscolor set on the meta theme-color
     * tag is used.
     * - background: the CSS background color, via getComputedStyle, is used.
     * This is useful if the background that is desired is not the one from the
     * element itself, but from one of its children.
     * - a specific color value.
     *
     * If no data-statuscolor attribute is found, then the background color for
     * the element, via getComputedStyle, is used. If that value is not a valid
     * color value, then the default statuscolor on the meta tag is used.
     *
     * Note that this method uses getComputedStyle. This could be expensive
     * depending on when it is called. For the card infrastructure, since it is
     * done as part of a card transition, and done before the card transition
     * code applies transition styles, the target element should not be visible
     * at the time of the query. In practice no negligble end user effect has
     * been seen, and that query is much more desirable than hardcoding colors
     * in JS or HTML.
     *
     * @param {Element} [element] the card element of interest. If no element is
     * passed, the the current card is used.
     */
    function setStatusColor(element) {
      var color;
      // Some use cases, like dialogs, are outside the card stack, so they may
      // not know what element to use for a baseline. In those cases, Cards
      // decides the target element.
      if (!element) {
        element = cards.getActiveCard();
      }

      // Try first for specific color override. Do a node query, since for
      // custom elements, the custom elment tag may not set its color, but the
      // template used inside the tag may.
      var statusElement = element.dataset.statuscolor ? element :
                          element.querySelector('[data-statuscolor]');

      if (statusElement) {
        color = statusElement.dataset.statuscolor;
        // Allow cards to just indicate they want the default.
        if (color === 'default') {
          color = null;
        } else if (color === 'background') {
          color = getComputedStyle(statusElement).backgroundColor;
        }
      } else {
        // Just use the background color of the original element.
        color = getComputedStyle(element).backgroundColor;
      }

      // Only use specific color values, not values like 'transparent'.
      if (color && color.indexOf('rgb') !== 0 && color.indexOf('#') !== 0) {
        color = null;
      }

      color = color || statusColorMeta.dataset.statuscolor;
      var existingColor = statusColorMeta.getAttribute('content');
      if (color !== existingColor) {
        statusColorMeta.setAttribute('content', color);
      }
    }

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

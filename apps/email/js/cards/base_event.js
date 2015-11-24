'use strict';
define(function(require) {
  var Emitter = require('evt').Emitter;

  return [
    // Every custom element is an evt Emitter!
    Emitter.prototype,

    {
      createdCallback: function() {
        // Mark the email custom elements that are generated in this fashion
        // with a specific class. This allows much more efficient query
        // selector calls to grab them all vs using something like '*' and
        // then filtering out the custom elements based on nodeName.
        this.classList.add('email-ce');

        Emitter.call(this);
      },

      /**
       * Shortcut for triggering a DOM custom event with a detail object. Use
       * this instead of evt when dealing with a custom element that wants to
       * communicate with ancestor elements about an event (so therefore could
       * bubble) that was based on a plain DOM event that happened inside the
       * custom element.
       *
       * @param  {String} eventName The event name.
       * @param  {Object} detail    The state info passed in event.detail.
       */
      emitDomEvent: function(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, {
          detail: detail,
          bubbles: true,
          cancelable: true
        }));
      },

      /**
       * Listens one time to a DOM event.
       * @param  {Element}   target   The element to receive the listener.
       * @param  {String}   eventName The event name.
       * @param  {Function} fn        Function to call, receives the event.
       */
      onceDomEvent: function(target, eventName, fn, capture = false) {
        var onceFn = function(event) {
          target.removeEventListener(eventName, onceFn, capture);
          fn(event);
        };
        target.addEventListener(eventName, onceFn, capture);
      }
    }
  ];
});

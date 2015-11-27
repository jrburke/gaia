'use strict';
define(function(require) {
  /**
   * Returns an array of objects that can be fed to the 'element' module to
   * create a prototype for a custom element. It takes an optional
   * `templateMixins` object that is the first object to be mixed in by the
   * "mixins insted of prototypes" construction that 'element' favors. This
   * templateMixins should come first, as it sets up the inner DOM structure
   * for an instance of the element, and needs to have been inserted before the
   * other mixins in this base are applied. The templateMixins are normally
   * passed to this function via a `require('template!...')` dependency. The
   * 'template' loader plugin knows how to set up an object for use in this type
   * of 'element' target. See the README.md in this file's directory for more
   * information on the custom element approach.
   * @param {Object|Array} [templateMixins] Handles the templating duties
   * for the inner HTML structure of the element.
   * @returns {Array} Array of objects for use in a mixin construction.
   */
  return function base(templateMixins) {
    // Set up the base mixin
    return [
      require('./base_event'),

      // Mix in the template first, so that its createdCallback is
      // called before the other createdCallbacks, so that the
      // template is there for things like l10n mixing and node
      // binding inside the template.
      templateMixins ? templateMixins : {},

      // Wire up support for auto-node binding
      require('./mixins/data-prop'),
      require('./mixins/data-event')
    ];
  };
});

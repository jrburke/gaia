'use strict';
define(function(require) {
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
    return function setStatusColor(element) {
      var color;

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
    };
});

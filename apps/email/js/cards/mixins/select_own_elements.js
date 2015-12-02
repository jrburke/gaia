'use strict';
define(function () {
  /**
   * Only selects nodes that match the selector if they are not buried inside
   * of another custom element.
   * @param  {String}   selector The CSS selector to use
   * @param  {Element}  ownElement The custom element instance that is asking
   *         for the selection.
   * @param  {Function} fn Function to execute for
   * @return {[type]}            [description]
   */
  return function selectOwnElements(selector, ownElement, fn) {
    [...ownElement.querySelectorAll(selector)]
    .forEach(function (element) {
      var parent = element;
      // Make sure the element is not nested in another component.
      while ((parent = parent.parentNode)) {
        if (parent.nodeName.indexOf('-') !== -1) {
          if (parent !== ownElement) {
            return;
          }
          break;
        }
      }
      if (!parent) {
        return;
      }

      fn(element);
    });
  };
});

define(function() {
  'use strict';

  return {
    createdCallback: function() {
      this.addEventListener('click', (evt) => {
          // Look for target or a parentNode that has a data-dclick property on
          // it.
          var element = evt.target;
          do {
            var action = element.dataset.dclick;
            if (action) {
              evt.preventDefault();
              evt.stopPropagation();
              this[action](evt, element);
              break;
            }

            // If reached this element, then reached the boundary of this logic,
            // stop looking for a handler.
            if (element === this) {
              break;
            }
          } while((element = element.parentNode));
      });
    }
  };
});

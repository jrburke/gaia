'use strict';
define(function(require) {
  function matchesClick(component, element, evt) {
    var action = element.dataset.event;
    if (action) {
      var parts = action.split(':');
      if (parts[0] === 'click') {
        evt.preventDefault();
        evt.stopPropagation();
        component[parts[1]](evt);
        return true;
      }
    }
  }

  return {
    createdCallback: function() {
      this.addEventListener('click', function(evt) {
          var element = evt.originalTarget;
          do {
            if (matchesClick(this, element, evt)) {
              break;
            }
          } while((element = element.parentNode));
      });
    }
  };
});

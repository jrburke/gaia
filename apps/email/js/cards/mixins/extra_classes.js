define(function() {
  'use strict';
  return {
    createdCallback: function() {
      // Set up extra classes and other node information that distinguishes
      // as a card. Doing this here so that by the time the createdCallback
      // provided by the card so that the DOM at that point can be used for
      // HTML caching purposes.
      if (this.extraClasses) {
        this.classList.add.apply(this.classList,
                                    this.extraClasses);
      }
    }
  };
});

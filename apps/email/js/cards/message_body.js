'use strict';
define(function(require) {

  return [
    require('./base')(require('template!./message_body.html')),
    require('./message_body_mixin'),
    {
      isCard: false,

      createdCallback: function() {
        this.header = null;
        this.handleBodyChange = this.handleBodyChange.bind(this);
      },

      onArgs: function(args) {
        this.header = args.header;
        this.scrollContainer = args.scrollContainer;
        this.onHeightChange = args.onHeightChange;

        this.header.getBody({ downloadBodyReps: true }, function(body) {
          // If the header has changed since the last getBody call, ignore.
          if (this.header.id !== body.id) {
            return;
          }

          this.body = body;

          // always attach the change listener.
          body.onchange = this.handleBodyChange;

          // if the body reps are downloaded show the message immediately.
          if (body.bodyRepsDownloaded) {
            this.buildBodyDom();
          }
        }.bind(this));
      }
    }
  ];
});

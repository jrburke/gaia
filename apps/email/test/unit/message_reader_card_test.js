'use strict';
/*global requireApp, suite, setup, testConfig, test, assert, suiteSetup,
         suiteTeardown */

requireApp('email/js/alameda.js');
requireApp('email/test/config.js');

suite('message_reader', function() {
  var subject, MessageReader, evt;
  function MockMailMessage() {}
  MockMailMessage.prototype = {
    makeCopy: function() {
      var copy = new MockMailMessage();
      copy.isRead = this.isRead;
      copy.isStarred = this.isStarred;
      return copy;
    },
    setRead: function(isRead) { this.isRead = isRead; },
    isRead: false,
    isStarred: false,
    setStarred: function() {}
  };
  var mockBody = {
    bodyReps: [],
    attachments: [{
      isDownloaded: false,
      isDownloadable: true,
      sizeEstimateInBytes: 1024,
      mimetype: '',
      filename: ''
    }]
  };

  suiteSetup(function(done) {
    testConfig({
      suiteTeardown: suiteTeardown,
      done: done
    }, ['evt', 'element!cards/message_reader'], function(e, mr) {
      evt = e;
      MessageReader = mr;
    });
  });

  setup(function() {
    subject = new MessageReader();
  });

  suite('_setMessage', function() {
    var message;
    setup(function() {
      message = new MockMailMessage();
      subject.readBtn.removeAttribute('data-l10n-id');
    });

    test('isRead', function() {
      message.isRead = true;
      subject._setMessage(message);
      assert.equal(subject.readBtn.getAttribute('data-l10n-id'),
        'message-mark-read-button');
    });

    test('!isRead', function() {
      subject._setMessage(message);
      assert.isNull(subject.readBtn.getAttribute('data-l10n-id'));
    });

    test('isStarred', function() {
      message.isStarred = true;
      subject._setMessage(message);
      assert.equal(subject.starBtn.getAttribute('aria-pressed'), 'true');
    });

    test('!isStarred', function() {
      subject._setMessage(message);
      assert.equal(subject.starBtn.getAttribute('aria-pressed'), 'false');
    });
  });

  suite('onToggleStar', function() {
    setup(function() {
      subject.hackMutationMessage = new MockMailMessage();
      subject.message = new MockMailMessage();
    });

    test('isStarred', function() {
      subject.onToggleStar();
      assert.isTrue(subject.starBtn.classList.contains('msg-star-btn-on'));
      assert.equal(subject.starBtn.getAttribute('aria-pressed'), 'true');
    });

    test('!isStarred', function() {
      subject.hackMutationMessage.isStarred = true;
      subject.onToggleStar();
      assert.isFalse(subject.starBtn.classList.contains('msg-star-btn-on'));
      assert.equal(subject.starBtn.getAttribute('aria-pressed'), 'false');
    });
  });

  suite('setRead', function() {
    setup(function() {
      subject.hackMutationMessage = new MockMailMessage();
      subject.message = new MockMailMessage();
    });

    test('isRead', function() {
      subject.setRead(true);
      assert.equal(subject.readBtn.getAttribute('data-l10n-id'),
        'message-mark-read-button');
    });

    test('!isRead', function() {
      subject.setRead(false);
      assert.equal(subject.readBtn.getAttribute('data-l10n-id'),
        'message-mark-unread-button');
    });
  });

  suite('clearDom', function() {
    var mockMessageContent = '<div>Message content</div>';
    setup(function() {
      subject.rootBodyNode.innerHTML = mockMessageContent;
      assert.equal(subject.rootBodyNode.innerHTML, mockMessageContent);
      assert.isNull(subject.rootBodyNode.querySelector('progress'));
    });

    test('test progress l10n', function() {
      subject.clearDom();
      var progress = subject.rootBodyNode.querySelector('progress');
      assert.ok(progress);
      assert.equal(progress.getAttribute('data-l10n-id'),
        'message-body-container-progress');
    });
  });

  suite('buildBodyDom', function() {
    setup(function() {
      subject.body = mockBody;
      subject.message = new MockMailMessage();
    });

    test('disabled attachments accessibility', function(done) {
      subject.body.attachments[0].isDownloadable = false;
      evt.once('metrics:contentDone', function() {
        assert.equal(subject.attachmentsContainer.children[0].getAttribute(
          'aria-disabled'), 'true');
        done();
      });
      subject.buildBodyDom();
    });

    test('attachments accessibility', function(done) {
      subject.body.attachments[0].isDownloadable = true;
      subject.body.attachments[0].isDownloaded = true;
      evt.once('metrics:contentDone', function() {
        assert.equal(subject.attachmentsContainer.children[0].getAttribute(
          'aria-disabled'), 'false');
        done();
      });
      subject.buildBodyDom();
    });
  });
});

'use strict';
/*jshint browser: true */
/*global requireApp, suite, testConfig, test, assert,
 suiteSetup, suiteTeardown */

requireApp('email/js/alameda.js');
requireApp('email/test/config.js');

suite('model accounts, startup', function() {
  var api, evt, model;

  suiteSetup(function(done) {
    testConfig(
      {
        suiteTeardown: suiteTeardown,
        done: done
      },
      ['api', 'evt', 'model_create'],
      function(a, e, mc) {
        api = a;
        evt = e;
        model = mc.defaultModel;
      }
    );
  });

  test('consistent view of accounts initialization', function(done) {
    var fakeSlice = evt.mix({
      items: [],
      release: function() { }
    });
    sinon.stub(api, 'viewAccounts').returns(fakeSlice);
    // Wait for model.init to finish this tick...
    setTimeout(function() {
      assert.ok(!model.accounts,
                'model.accounts should not be set ' +
                'before accounts.oncomplete fires');

      fakeSlice.on('complete');

      assert.ok(model.accounts,
                'model.accounts _should_ be set ' +
                'after accounts.oncomplete fires');
      done();
    });
    model.init();
  });
});


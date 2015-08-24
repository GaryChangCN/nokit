kit = require './kit'
{ _, Promise } = kit
br = kit.require 'brush'
assert = require 'assert'

###*
 * A simple promise based module for unit tests.
 * @param  {Object} opts Defaults:
 * ```coffeescript
 * {
 * 	isBail: true
 * 	logPass: (msg) ->
 * 		console.log br.green('o'), msg
 * 	logFail: (err) ->
 * 		console.error br.red('x'), err
 * 	logFinal: (passed, failed) ->
 * 		console.log """
 * 		#{br.grey '----------------'}
 * 		pass  #{br.green passed}
 * 		fail  #{br.red failed}
 * 		"""
 * 	onEnd: (passed, failed) ->
 * 		if failed
 * 			process.exit 1
 * }
 * ```
 * @return {Promise}
 * @example
 * ```coffeescript
 * ken = kit.require 'ken'
 * test = ken()
 *
 * # Async tests
 * test.async [
 * 	test 'basic 1', ->
 * 		ken.eq 'ok', 'ok'
 * 	test 'basic 2', ->
 * 		ken.deepEq { a: 1, b: 2 }, { a: 1, b: 2 }
 *
 * 	# Sync tests
 * 	kit.flow [
 * 		test 'basic 3', ->
 * 			ken.eq 'ok', 'ok'
 * 		test 'basic 4', ->
 * 			ken.eq 'ok', 'ok'
 * 	]
 * ]
 * ```
###
ken = (opts = {}) ->
	_.defaults opts, {
		isBail: true
		logPass: (msg) ->
			console.log br.green('o'), br.grey(msg)
		logFail: (err) ->
			console.error br.red('x'), err
		logFinal: (passed, failed) ->
			console.log """
			#{br.grey '----------------'}
			pass #{br.green passed}
			fail #{br.red failed}
			"""
		onEnd: (passed, failed) ->
			if failed
				process.exit 1
	}

	passed = 0
	failed = 0

	test = (msg, fn) ->
		->
			Promise.resolve()
			.then fn
			.then ->
				passed++
				opts.logPass msg
			, (err) ->
				failed++
				opts.logFail err
				Promise.reject err if opts.isBail

	onFinal = ->
		opts.logFinal passed, failed
		opts.onEnd passed, failed

	_.extend test, {
		async: ->
			kit.async.apply 0, arguments
			.then onFinal, onFinal
		sync: ->
			kit.flow.apply(0, arguments)()
			.then onFinal, onFinal
	}

module.exports = _.extend ken, {
	eq: assert.strictEqual
	deepEq: assert.deepEqual
}
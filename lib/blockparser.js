"use strict";
var grunt = require('grunt'),
	_ = grunt.util._,
	util = require('util'),
	path = require('path');

var BlockParser = module.exports = function(origHtml, task, options) {
	this.origHtml = origHtml;
	this.task = task;
	this.options = options;
	this._blockRE =
		'(?:'

			// Indent whitespace
			+ '(^[ \t]+)?'

			// Begin tag
			+ '<!--[ \t]*' + options.tagName

			// Type
			+ ':([^ \\-]+)'

			// Args
			+ '(?:[ ]+(.+?))?'

			// Optional self-closing.
			+ '[ ]*(/)?-->'

			+ ')|('

			// End Tag
			+ '<!--[ \t]*end' + options.tagName + '[ \t]*-->'

			+ ')';
	this._blockREFlags = 'mg';
};

_.extend(BlockParser.prototype, {

	parse: function() {
		var re = new RegExp(this._blockRE, this._blockREFlags),
			contents = '',
			lastIndex = 0,
			match;

		while (!_.isNull(match = re.exec(this.origHtml))) {
			var indent = match[1] || '';
			contents += this.origHtml.substring(lastIndex, match.index)
				+ indent
				+ this._beginBlock(re, match);

			lastIndex = re.lastIndex;
		}

		return contents + this.origHtml.substring(lastIndex);
	},

	_beginBlock: function(re, match) {
		var contents = '',
			indent = match[1] || '',
			type = match[2],
			args = match[3],
			lastIndex = re.lastIndex;

		if (_.isString(match[4])) {
			grunt.event.emit(this.task.name + '.blocksingle', { type: type, args: args, beginTag: match[0] });
		}
		else {
			grunt.event.emit(this.task.name + '.blockbegin', { type: type, args: args, beginTag: match[0] });

			var nextMatch;
			while (!_.isNull(nextMatch = re.exec(this.origHtml)) && !_.isString(nextMatch[5])) {
				contents += this.origHtml.substring(lastIndex, nextMatch.index) + indent;

				var subBlock = this._beginBlock(re, nextMatch);
				if (subBlock === false)
					return false;

				// Append the result of the sub block.
				contents += subBlock;

				// Reset the last index to where the sub block left off.
				lastIndex = re.lastIndex;
			}

			if (_.isNull(nextMatch)) {
				grunt.fail.warn('Missing end tag for block. ' + match[0]);
				return false;
			}

			// Append any contents remaining after sub blocks.
			// If there were no sub blocks, then this will be the
			// contents since this block's begin tag.
			contents += this.origHtml.substring(lastIndex, nextMatch.index);
		}

		var parsed = this._runParser(indent, type, args, contents);
		if (!_.isString(match[4]))
			grunt.event.emit(this.task.name + '.blockend', { type: type, args: args, contents: contents, beginTag: match[0] });

		return parsed;
	},

	_runParser: function(indent, type, args, contents) {
		var parser = null;

		// User-defined type parser.
		if (this.options.typeParser && _.isFunction(this.options.typeParser[type]))
			parser = this.options.typeParser[type];

		// Built-in type parsers.
		else if (this.typeParser && _.isFunction(this.typeParser[type]))
			parser = this.typeParser[type];

		if (parser) {
			var replace = parser.apply(this, [ { type: type, args: args, contents: contents, indent: indent } ]);

			if (_.isString(replace))
				return replace;

			else if (_.isArray(replace))
				return replace.join('\n' + indent);
		}

		return '';
	},

	splitArgs: function(args, limit) {
		if (!_.isString(args))
			return args;

		if (limit == 1)
			return [ args ];

		var re = /^([^ \t]+)(?:[ \t]+(.+)])?$/,
			ret = [],
			match;

		if (!_.isFinite(limit))
			limit = -1;

		while (_.isString(args) && !_.isNull(match = args.match(re))) {
			ret.push(match[1]);
			args = match[2];

			if (limit > 0)
				limit--;

			if (limit == 0) {
				ret.push(args);
				return ret;
			}
		}

		return ret;
	},

	getTags: function(elementName, html) {
		var tagRE = new RegExp('<' + elementName + '( .+?)/?>', 'ig'),
			attrRE = / ([a-z0-9_\-]+)="([^"]+)"/ig,
			tags = [],
			tagMatch, attrMatch;

		while (!_.isNull(tagMatch = tagRE.exec(html))) {
			var tag = {
				_html: tagMatch[0]
			};

			while (!_.isNull(attrMatch = attrRE.exec(tagMatch[1]))) {
				tag[attrMatch[1]] = attrMatch[2];
			}

			tags.push(tag);
		}

		return tags;
	},

	typeParser: {
		uncomment: function(opts) {
			if (opts && !_.isString(opts.contents))
				return '';

			return opts.contents.replace(/^(\s*)<!--/, '$1').replace(/-->(\s*)$/, '$1');
		},

		requirejs: function(opts) {
			var syntax = 'Syntax: <data-main> [<dest> [<target>]] [<options-json>]',
				args = opts.args;

			if (!_.isString(args))
				grunt.fail.warn('Missing arguments. ' + syntax);

			var target = this.options.target,
				outTags = [],
				splitArgs = args.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '').split(/ /);

			// Parse Arguments

			if (splitArgs.length < 1)
				grunt.fail.warn('Missing arguments. ' + syntax);

			// <data-main>
			var main = splitArgs.shift();
			grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Set main to " + main });
			splitArgs = splitArgs.length ? splitArgs.join(' ').replace(/^[ \t]+/, '').split(/ /) : splitArgs;

			// <dest>
			var dest = { short: main + '.js', full: path.join(this.options.baseUrl, main + '.js') };
			if (splitArgs.length && !splitArgs[0].match(/^[ \t]*{/)) {
				dest = { short: splitArgs[0], full: path.join(this.options.baseUrl, splitArgs[0]) };
				grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Set destination to " + dest.full });
				splitArgs.shift();
				splitArgs = splitArgs.length ? splitArgs.join(' ').replace(/^[ \t]+/, '').split(/ /) : splitArgs;
			}

			// <target>
			if (splitArgs.length && !splitArgs[0].match(/^[ \t]*{/)) {
				target = splitArgs.shift();
				grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Set target to " + target });
				splitArgs = splitArgs.length ? splitArgs.join(' ').replace(/^[ \t]+/, '').split(/ /) : splitArgs;
			}

			// <options>
			var argOptions = {};
			if (splitArgs.length && splitArgs[0].match(/^[ \t]*{/)) {
				try {
					argOptions = JSON.parse(splitArgs.join(' '));
				}
				catch (e) {
					grunt.fail.warn('Invalid JSON (' + e + '): ' + splitArgs.join(' '));
				}
			}

			// Process tags.

			outTags.push('<script src="' + dest.short + '"></script>');
			grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Added tag: " + outTags[outTags.length - 1] });

			grunt.event.emit(this.task.name + '.requirejs', {
				target: target,
				src: main + '.js',
				dest: dest.full,
				options: _.extend({
					baseUrl: path.dirname(main),
					name: path.basename(main),
					out: dest.full,
					mainConfigFile: main + '.js'
				}, argOptions)
			});

			grunt.event.emit(this.task.name + '.uglify', { target: target, src: dest.full, dest: dest.full });

			return outTags;
		},

		js: function(opts) {
			var syntax = 'Syntax: <dest>',
				args = opts.args;

			if (!_.isString(args))
				grunt.fail.warn('Missing arguments. ' + syntax);

			var contents = opts.contents,
				target = this.options.target,
				outTags = [],
				splitArgs = args.split(/[ \t]+/);

			if (splitArgs.length < 1)
				grunt.fail.warn('Missing arguments. ' + syntax);

			var dest = { short: splitArgs[0], full: path.join(this.options.baseUrl, splitArgs[0]) };
			grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Set destination to " + dest.full });

			_.each(this.getTags('script', contents), function(tag){
				grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Parsing tag: " + tag._html });

				if (!_.isString(tag.src)) {
					grunt.fail.warn("Tag missing src attribute: " + tag._html);
					return false;
				}

				if (!grunt.file.isFile(tag.src)) {
					grunt.fail.warn("Cannot find file for src: " + tag._html);
					return false;
				}

				if (!outTags.length) {
					outTags.push('<script src="' + dest.short + '"></script>');
					grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Added tag: " + outTags[outTags.length - 1] });
				}

				grunt.event.emit(this.task.name + '.uglify', { target: target, src: tag.src, dest: dest.full });

				if (_.isString(tag['data-main'])) {
					var requireDest = { short: _.isString(tag['data-dest']) ? tag['data-dest'] : tag['data-main'] };
					requireDest.full = path.join(this.options.baseUrl, requireDest.short);

					var requireTarget = tag['data-target'] ? tag['data-target'] : target;

					outTags.push('<script src="' + requireDest.short + '"></script>');
					grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Added tag: " + outTags[outTags.length - 1] });

					grunt.event.emit(this.task.name + '.requirejs', {
						target: requireTarget,
						src: tag['data-main'] + '.js',
						dest: requireDest.full,
						options: {
							baseUrl: path.dirname(tag['data-main']),
							name: path.basename(tag['data-main']),
							out: requireDest.full,
							mainConfigFile: tag['data-main'] + '.js'
						}
					});

					grunt.event.emit(this.task.name + '.uglify', { target: target, src: requireDest.full, dest: requireDest.full });
				}

			}, this);

			return outTags;
		},

		less: function(opts) {
			var syntax = 'Syntax: <dest>',
				args = opts.args;

			if (!_.isString(args))
				grunt.fail.warn('Missing arguments. ' + syntax);

			var contents = opts.contents,
				target = this.options.target,
				outTags = [],
				splitArgs = args.split(/[ \t]+/);

			// Parse Arguments

			if (splitArgs.length < 1)
				grunt.fail.warn('Missing arguments. ' + syntax);

			var dest = { short: splitArgs[0], full: path.join(this.options.baseUrl, splitArgs[0]) };
			grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Set destination to " + dest.full });
			splitArgs.shift();

			_.each(this.getTags('link', contents), function(tag){
				grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Parsing tag: " + tag._html });

				if (!_.isString(tag.href)) {
					grunt.fail.warn("Tag missing href attribute: " + tag._html);
					return false;
				}

				if (!_.isString(tag.rel)) {
					grunt.fail.warn("Tag missing rel attribute: " + tag._html);
					return false;
				}

				if (!_.isString(tag.type)) {
					grunt.fail.warn("Tag missing type attribute: " + tag._html);
					return false;
				}

				if (tag.type != "text/css") {
					grunt.fail.warn("Tag's type attribute is not 'text/css': " + tag._html);
					return false;
				}

				if (!grunt.file.isFile(tag.href)) {
					grunt.fail.warn("Cannot find file for href: " + tag._html);
					return false;
				}

				if (!outTags.length) {
					outTags.push('<link rel="stylesheet" type="text/css" href="' + dest.short + '">');
					grunt.event.emit(this.task.name + '.notice', { verbose: true, message: "Added tag: " + outTags[outTags.length - 1] });
				}

				grunt.event.emit(this.task.name + '.less', { target: target, src: tag.href, dest: dest.full });
			}, this);

			return outTags;
		}
	}
});
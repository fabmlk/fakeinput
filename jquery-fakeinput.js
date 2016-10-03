(function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            "jquery"
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(require("jquery"));
    } else {
        // Browser globals
        factory(jQuery);
    }
}(function ($) {

    function FakeInput() {
        this.defaults = {

        };
    }

    $.extend(FakeInput.prototype, {
        markerClassName: 'fab-isFakeInput',
        propertyName: 'fab-fakeinput',

        setDefaults: function (options) {
            $.extend(this.defaults, options || {});
            return this;
        },

        _attachPlugin: function (target, options) {
            target = $(target);

            if (target.hasClass(this.markerClassName)) {
                return;
            }

            var inst = {
                options: $.extend({}, this.defaults),
            };
            target.addClass(this.markerClassName)
                .data(this.propertyName, inst);

            this._optionPlugin(target, options);
        },

        _optionPlugin: function (target, options, value) {
            /* start of boilerplate code common to most jquery plugins */
            target = $(target);
            var inst = target.data(this.propertyName); // retrieve current instance settings

            if (!options || (typeof options == 'string' && value == null)) {
                // Get option
                var name = options;
                options = (inst || {}).options;
                return (options && name ? options[name] : options);
            }

            if (!target.hasClass(this.markerClassName)) { // if plugin not yet initialized
                return;
            }

            options = options || {};
            if (typeof options == 'string') { // handle single named option
                var name = options;
                options = {};
                options[name] = value;
            }
            $.extend(inst.options, options); // update with new options
            /* end of boilerplate code */
        },

    });

    var plugin = $.fakeinput = new FakeInput();


    $.fn.fakeinput = function (options) {
        var otherArgs = Array.prototype.slice.call(arguments, 1);
        return this.each(function () {
            if (typeof options == 'string') {
                if (!plugin['_' + options + 'Plugin']) {
                    throw 'Unkown method: ' + options;
                }
                plugin['_' + options + 'Plugin'].apply(plugin, [this].concat(otherArgs));
            } else {
                plugin._attachPlugin(this, options || {});
            }
        });
    };

    $.fn.fakeinput.defaults = plugin.defaults;
}));
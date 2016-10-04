(function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            "jquery",
            "stylehelper"
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(require("jquery"), require("stylehelper"));
    } else {
        // Browser globals
        factory(jQuery, StyleHelper);
    }
}(function ($, StyleHelper) {

    var currentlyFocused = $();

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
            var inst;

            if (target.hasClass(this.markerClassName)) {
                return;
            }

            inst = {
                options: $.extend({}, this.defaults),
            };

            if (target.is("input[type='text']")) { // if an input text is specified, replace it
                // here we want to scavenge all attributes/properties assigned inline on the input
                // as input is a children-less element, using outerHTML fits the need.
                // Note: this is does not preserve attached event handlers! there is no way to find them out in pure javascript!
                // Also jquery remove jquery event handlers + data when replacing.
                target = $(target[0].outerHTML.replace("input", "span")).replaceAll(target); // replaceAll returns the new object, whereas replaceWith the old one!
                target.removeAttr("type"); // remove type='text'
            }

            target.addClass(this.markerClassName)
                .data(this.propertyName, inst);

            this._initCaret();
            this._impersonateInputStyle(target);
            this._impersonateInputAttributes(target);
            this._initEvents(target);

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


        _initCaret: function (caretChar) {
            var $caret = $('#' + this.propertyName + '-fakecaret');
            caretChar = caretChar || '|';

            if (!$caret.length) {
                $caret = $("<span id='" + this.propertyName + "-fakecaret' class='"+ this.propertyName +"-fakecaret'>" + caretChar + "</span>");
                StyleHelper.makeInert($caret[0]);
                $("body").append($caret);
            }
            return $caret;
        },



        _impersonateInputStyle: function ($target) {
            var $input = $('#' + this.propertyName + '-impersonated-input'),
                stylesToRestore = {},
                computedInputStyle = {},
                style = null,
                target = $target[0]
            ;

            if (!$input.length) {

                $input = $("<input type='text' id='" + this.propertyName + "-impersonated-input'>");
                stylesToRestore = StyleHelper.makeInert($input[0]);
                $("body").append($input);

                computedInputStyle = window.getComputedStyle($input[0]);
                style = StyleHelper.addCSSRule('.' + this.markerClassName +  '{' + computedInputStyle.cssText + ')');

                for (var prop in stylesToRestore) { // restore default to before made inert
                    if (stylesToRestore.hasOwnProperty(prop)) {
                        style[prop] = stylesToRestore[prop];
                    }
                }
            }
            $target.text($target.attr("value") || "");

            target.selectionStart = target.selectionEnd = $target.text().length;
        },




        _impersonateInputAttributes: function ($target) {
            var target = $target[0];

            Object.defineProperty(target, "value", {
                get: function () {
                    return $target.text();
                },
                set: function (val) {
                    $target.text(val);
                    target.selectionStart = target.selectionEnd = val.length;
                }
            });
            target.selectionStart = 0;
            target.selectionEnd = 0;

            target.focus = function () {
                // don't use jquery trigger as it will call .focus() => infinite loop!
                var focusEvent = new FocusEvent("focus");
                target.dispatchEvent(focusEvent);
            };
            target.blur = function () {
                // don't use jquery trigger as it will call .blur() => infinite loop!
                var blurEvent = new FocusEvent("blur"); // Blur hérite de FocusEvent interface
                target.dispatchEvent(blurEvent);
            };
        },



        _getCaretCoordinates: function ($target) {
            var target = $target[0],
                textNode = target.childNodes[0],   // the text node is always the first child
                range = document.createRange(),
                rangeRect,
                targetRect
            ;

            if (textNode === undefined) {
                textNode = document.createTextNode("");
                $target.append(textNode);
            }

            range.setStart(textNode, 0);
            range.setEnd(textNode, Math.min(target.selectionEnd, textNode.textContent));

            rangeRect = range.getBoundingClientRect();
            targetRect = target.getBoundingClientRect();

            return [
                Math.max(targetRect.top, 0),
                Math.max(0, rangeRect.right - 3) // shift 3 pixel
            ];
        },


        _getSelectionRangePos: function ($target) {
            var start = -1, end = -1,
                userSelection = window.getSelection()
            ;

            if (userSelection.anchorNode === $target[0].childNodes[0]) { // first child must be text node
                start = userSelection.anchorOffset;
                end = start + userSelection.toString().length;
            }

            return [start, end];
        },


        _showCursor: function ($target) {
            var coords = this._getCaretCoordinates($target),
                $fakeCaret = $('#' + this.propertyName + '-fakecaret')
            ;

            $fakeCaret.css({
                // reminder: jquery converts a number to string and append "px" when it detects a number
                top: coords[0],
                left: coords[1],
                height: $target.outerHeight()
            });

            StyleHelper.unmakeInert($fakeCaret[0]);
        },



        _initEvents: function ($target) {
            $target.on("click", function (e) {
                var $this = $(this),
                    selectionRange = plugin._getSelectionRangePos($this)
                ;

                // Oddly, when we click to the very far left of the element, the selectionRange detects
                // the adjacent of this one, though we know we are inside the node!
                // This does not seam to occur at the very far right, so we can be safe to assume we are in this
                // situation when we detect -1.
                // Bug WebKit/Blink? Anyway, in that case force selection at the start.
                this.selectionStart = selectionRange[0] === -1 ? 0 : selectionRange[0];
                this.selectionEnd = selectionRange[1] === -1 ? 0 : selectionRange[1];

                console.log("clicked");
                this.focus();

                e.stopPropagation();
            })
                .on("focus", function () {
                    plugin._showCursor($(this));
                    currentlyFocused = $(this);
                    console.log("focused");
                })
                .on("blur", function () {
                    StyleHelper.makeInert(document.getElementById(plugin.propertyName));
                })
                .on("keypress", function (e) {
                    var selStart = this.selectionStart,
                        selEnd = this.selectionEnd,
                        value = this.value
                    ;

                    if (e.which !== 13) { // "Enter"
                        this.value = value.slice(0, selStart) + e.key + value.slice(selEnd);
                        this.selectionStart = this.selectionEnd = selStart + 1;
                        plugin._showCursor($(this));
                    }
                })
                .on("keydown", function (e) {
                    var selStart = this.selectionStart,
                        selEnd = this.selectionEnd,
                        value = this.value,
                        $this = $(this)
                    ;

                    if (e.which === 8 || e.which === 46) { // backspace or del
                        if (selEnd === selStart) { // pas de text selected
                            selStart = selStart > 0 ? selStart - 1 : selStart;
                        }
                        this.value = value.slice(0, selStart) + value.slice(selEnd);
                        this.selectionStart = this.selectionEnd = selStart;
                        plugin._showCursor($this);

                        return false; // prevent default & stop bubbling
                    }
                    if (e.which === 37) { // left arrow
                        this.selectionStart = this.selectionEnd = Math.max(this.selectionStart - 1, 0);
                        plugin._showCursor($this);
                    } else if (e.which == 39) { // right arrow
                        this.selectionStart = this.selectionEnd = Math.min(this.selectionEnd + 1, this.value.length);
                        plugin._showCursor($this);
                    }
                });

            $(document).on("click", function (e) {
                if (!$(e.target).is('.' + plugin.markerClassName)) {
                    currentlyFocused.blur();
                    console.log("blurred");
                }
            });


        }


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
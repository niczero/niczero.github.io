var niczero = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function exclude_internal_props(props) {
        const result = {};
        for (const k in props)
            if (k[0] !== '$')
                result[k] = props[k];
        return result;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            while (render_callbacks.length) {
                const callback = render_callbacks.pop();
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment) {
            $$.update($$.dirty);
            run_all($$.before_render);
            $$.fragment.p($$.dirty, $$.ctx);
            $$.dirty = null;
            $$.after_render.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.callbacks.push(() => {
                outroing.delete(block);
                if (callback) {
                    block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_render } = component.$$;
        fragment.m(target, anchor);
        // onMount happens after the initial afterUpdate. Because
        // afterUpdate callbacks happen in reverse order (inner first)
        // we schedule onMount callbacks before afterUpdate callbacks
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_render.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        if (component.$$.fragment) {
            run_all(component.$$.on_destroy);
            component.$$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            component.$$.on_destroy = component.$$.fragment = null;
            component.$$.ctx = {};
        }
    }
    function make_dirty(component, key) {
        if (!component.$$.dirty) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty = blank_object();
        }
        component.$$.dirty[key] = true;
    }
    function init(component, options, instance, create_fragment, not_equal$$1, prop_names) {
        const parent_component = current_component;
        set_current_component(component);
        const props = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props: prop_names,
            update: noop,
            not_equal: not_equal$$1,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_render: [],
            after_render: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty: null
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, props, (key, value) => {
                if ($$.ctx && not_equal$$1($$.ctx[key], $$.ctx[key] = value)) {
                    if ($$.bound[key])
                        $$.bound[key](value);
                    if (ready)
                        make_dirty(component, key);
                }
            })
            : props;
        $$.update();
        ready = true;
        run_all($$.before_render);
        $$.fragment = create_fragment($$.ctx);
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /* node_modules/fa-svelte/src/Icon.html generated by Svelte v3.6.3 */

    function create_fragment(ctx) {
    	var svg, path_1;

    	return {
    		c() {
    			svg = svg_element("svg");
    			path_1 = svg_element("path");
    			attr(path_1, "fill", "currentColor");
    			attr(path_1, "d", ctx.path);
    			attr(svg, "aria-hidden", "true");
    			attr(svg, "class", "" + ctx.classes + " svelte-p8vizn");
    			attr(svg, "role", "img");
    			attr(svg, "xmlns", "http://www.w3.org/2000/svg");
    			attr(svg, "viewBox", ctx.viewBox);
    		},

    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, path_1);
    		},

    		p(changed, ctx) {
    			if (changed.path) {
    				attr(path_1, "d", ctx.path);
    			}

    			if (changed.classes) {
    				attr(svg, "class", "" + ctx.classes + " svelte-p8vizn");
    			}

    			if (changed.viewBox) {
    				attr(svg, "viewBox", ctx.viewBox);
    			}
    		},

    		i: noop,
    		o: noop,

    		d(detaching) {
    			if (detaching) {
    				detach(svg);
    			}
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { icon } = $$props;

      let path = [];
      let classes = "";
      let viewBox = "";

    	$$self.$set = $$new_props => {
    		$$invalidate('$$props', $$props = assign(assign({}, $$props), $$new_props));
    		if ('icon' in $$new_props) $$invalidate('icon', icon = $$new_props.icon);
    	};

    	$$self.$$.update = ($$dirty = { icon: 1, $$props: 1 }) => {
    		if ($$dirty.icon) { $$invalidate('viewBox', viewBox = "0 0 " + icon.icon[0] + " " + icon.icon[1]); }
    		$$invalidate('classes', classes = "fa-svelte " + ($$props.class ? $$props.class : ""));
    		if ($$dirty.icon) { $$invalidate('path', path = icon.icon[4]); }
    	};

    	return {
    		icon,
    		path,
    		classes,
    		viewBox,
    		$$props: $$props = exclude_internal_props($$props)
    	};
    }

    class Icon extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, ["icon"]);
    	}
    }

    var faGithub = {
      prefix: 'fab',
      iconName: 'github',
      icon: [496, 512, [], "f09b", "M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"]
    };
    var faLinkedin = {
      prefix: 'fab',
      iconName: 'linkedin',
      icon: [448, 512, [], "f08c", "M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z"]
    };
    var faSith = {
      prefix: 'fab',
      iconName: 'sith',
      icon: [448, 512, [], "f512", "M0 32l69.71 118.75-58.86-11.52 69.84 91.03a146.741 146.741 0 0 0 0 51.45l-69.84 91.03 58.86-11.52L0 480l118.75-69.71-11.52 58.86 91.03-69.84c17.02 3.04 34.47 3.04 51.48 0l91.03 69.84-11.52-58.86L448 480l-69.71-118.78 58.86 11.52-69.84-91.03c3.03-17.01 3.04-34.44 0-51.45l69.84-91.03-58.86 11.52L448 32l-118.75 69.71 11.52-58.9-91.06 69.87c-8.5-1.52-17.1-2.29-25.71-2.29s-17.21.78-25.71 2.29l-91.06-69.87 11.52 58.9L0 32zm224 99.78c31.8 0 63.6 12.12 87.85 36.37 48.5 48.5 48.49 127.21 0 175.7s-127.2 48.46-175.7-.03c-48.5-48.5-48.49-127.21 0-175.7 24.24-24.25 56.05-36.34 87.85-36.34zm0 36.66c-22.42 0-44.83 8.52-61.92 25.61-34.18 34.18-34.19 89.68 0 123.87s89.65 34.18 123.84 0c34.18-34.18 34.19-89.68 0-123.87-17.09-17.09-39.5-25.61-61.92-25.61z"]
    };
    var faStackOverflow = {
      prefix: 'fab',
      iconName: 'stack-overflow',
      icon: [384, 512, [], "f16c", "M290.7 311L95 269.7 86.8 309l195.7 41zm51-87L188.2 95.7l-25.5 30.8 153.5 128.3zm-31.2 39.7L129.2 179l-16.7 36.5L293.7 300zM262 32l-32 24 119.3 160.3 32-24zm20.5 328h-200v39.7h200zm39.7 80H42.7V320h-40v160h359.5V320h-40z"]
    };
    var faTwitter = {
      prefix: 'fab',
      iconName: 'twitter',
      icon: [512, 512, [], "f099", "M459.37 151.716c.325 4.548.325 9.097.325 13.645 0 138.72-105.583 298.558-298.558 298.558-59.452 0-114.68-17.219-161.137-47.106 8.447.974 16.568 1.299 25.34 1.299 49.055 0 94.213-16.568 130.274-44.832-46.132-.975-84.792-31.188-98.112-72.772 6.498.974 12.995 1.624 19.818 1.624 9.421 0 18.843-1.3 27.614-3.573-48.081-9.747-84.143-51.98-84.143-102.985v-1.299c13.969 7.797 30.214 12.67 47.431 13.319-28.264-18.843-46.781-51.005-46.781-87.391 0-19.492 5.197-37.36 14.294-52.954 51.655 63.675 129.3 105.258 216.365 109.807-1.624-7.797-2.599-15.918-2.599-24.04 0-57.828 46.782-104.934 104.934-104.934 30.213 0 57.502 12.67 76.67 33.137 23.715-4.548 46.456-13.32 66.599-25.34-7.798 24.366-24.366 44.833-46.132 57.827 21.117-2.273 41.584-8.122 60.426-16.243-14.292 20.791-32.161 39.308-52.628 54.253z"]
    };

    /* src/Index.svelte generated by Svelte v3.6.3 */

    // (34:107) <Icon icon={faLinkedin} aria-hidden="true">
    function create_default_slot(ctx) {
    	return {
    		c: noop,
    		m: noop,
    		d: noop
    	};
    }

    function create_fragment$1(ctx) {
    	var div31, div30, header, div0, t0, div1, t4, div2, ul0, li0, a0, t5, li1, a1, t6, li2, a2, t7, li3, a3, t8, li4, a4, t9, nav, ul1, li5, a5, t11, li6, a6, t13, li7, a7, t15, li8, a8, t17, li9, a9, t19, li10, a10, t21, div3, t22, main, current, dispose;

    	var icon0 = new Icon({
    		props: {
    		icon: faGithub,
    		"aria-hidden": "true"
    	}
    	});

    	var icon1 = new Icon({
    		props: {
    		icon: faSith,
    		"aria-hidden": "true"
    	}
    	});

    	var icon2 = new Icon({
    		props: {
    		icon: faLinkedin,
    		"aria-hidden": "true",
    		$$slots: { default: [create_default_slot] },
    		$$scope: { ctx }
    	}
    	});

    	var icon3 = new Icon({
    		props: {
    		icon: faStackOverflow,
    		"aria-hidden": "true"
    	}
    	});

    	var icon4 = new Icon({ props: { icon: faTwitter } });

    	return {
    		c() {
    			div31 = element("div");
    			div30 = element("div");
    			header = element("header");
    			div0 = element("div");
    			div0.innerHTML = `<img class="w-full" src="img/paris.png" srcset="img/paris_2x.png 336w, img/paris.png 168w" sizes="168px" width="168" height="168" alt="avatar">`;
    			t0 = space();
    			div1 = element("div");
    			div1.innerHTML = `<h1 class="uppercase text-white">Nic Sandfield</h1> <span class="text-gray-600 text-sm">Data-Analyst/Developer</span>`;
    			t4 = space();
    			div2 = element("div");
    			ul0 = element("ul");
    			li0 = element("li");
    			a0 = element("a");
    			icon0.$$.fragment.c();
    			t5 = space();
    			li1 = element("li");
    			a1 = element("a");
    			icon1.$$.fragment.c();
    			t6 = space();
    			li2 = element("li");
    			a2 = element("a");
    			icon2.$$.fragment.c();
    			t7 = space();
    			li3 = element("li");
    			a3 = element("a");
    			icon3.$$.fragment.c();
    			t8 = space();
    			li4 = element("li");
    			a4 = element("a");
    			icon4.$$.fragment.c();
    			t9 = space();
    			nav = element("nav");
    			ul1 = element("ul");
    			li5 = element("li");
    			a5 = element("a");
    			a5.textContent = "Intro";
    			t11 = space();
    			li6 = element("li");
    			a6 = element("a");
    			a6.textContent = "Perl";
    			t13 = space();
    			li7 = element("li");
    			a7 = element("a");
    			a7.textContent = "MySQL";
    			t15 = space();
    			li8 = element("li");
    			a8 = element("a");
    			a8.textContent = "Git";
    			t17 = space();
    			li9 = element("li");
    			a9 = element("a");
    			a9.textContent = "Recipe";
    			t19 = space();
    			li10 = element("li");
    			a10 = element("a");
    			a10.textContent = "Contact";
    			t21 = space();
    			div3 = element("div");
    			t22 = space();
    			main = element("main");
    			main.innerHTML = `<section id="intro"><div class="section-header"><h2>Introduction</h2></div> <div><p>Here is a brief overview of my main OSS projects. I try to use
			          permissive (eg MIT) licensing where I can (but check each project
			          for specifics). Since becoming a parent, my time for opensource
			          development is rationed to focused bursts, so the documentation
			          never quite keeps up. I will endeavour to write some articles to
			          provide a more welcoming introduction; some of these packages
			          represent weeks of work and most are being used in production
			          environments.</p></div></section> <section id="perl"><div class="section-header"><h2>Perl</h2></div> <div><ul><li><a href="https://github.com/niczero/mojar" class="font-normal">Mojar</a> is my namespace for utilities,
			            modules, and agents to extend the Mojolicious platform for
			            accessing additional (eg non-web) uses or third-party
			            interfaces.</li> <li>If you are not yet using a connector-based accessor for
			            MySQL, take a look at <a href="https://github.com/niczero/mojar-mysql" class="font-normal">Mojar::Mysql</a>. The <a href="https://metacpan.org/pod/Mojar::Mysql::Connector" class="font-normal">::Connector</a> module provides a reusable
			            connector (a database handle builder) and several distinctive
			            conveniences, in particular support for using external
			            configuration files for storing your database credentials and
			            connection parameters. This alone can make testing and automated
			            monitoring much easier and reliable. The package also includes
			            DBA power tools, for example for monitoring and repairing
			            replication.</li> <li>If you are looking for an API to reliably batch-download your
			            Google Analytics data, for instance to import into a
			            datawarehouse, <strong>Mojar::Google::Analytics</strong> is your friend.</li></ul></div></section> <section id="mysql"><div class="section-header"><h2>MySQL</h2></div> <div><ul><li><a href="https://github.com/niczero/mojar-mysql" class="font-normal">Mojar::Mysql</a> is your box of Perl
			            powertools for accessing, monitoring, repairing, and controlling
			            MySQL instances, from v4.0 to v8.0.</li> <li>By supporting the use of <code>.cnf</code> accessor files,
			            the <a href="https://metacpan.org/pod/Mojar::Mysql::Connector" class="font-normal">::Connector</a> module lets your Perl code
			            (Mojolicious apps, Zabbix agents, RT instances, CheckMk scripts,
			            …) utilise the same accessors as your bash scripts, MySQL
			            tools, and commandline testing.</li> <li>The <a href="https://metacpan.org/pod/Mojar::Mysql::Replication" class="font-normal">::Replication</a> module facilitates
			            monitoring and repairing replication.</li> <li>The <a href="https://metacpan.org/pod/Mojar::Mysql::Util" class="font-normal">::Util</a> module contains the marvellous
			            <span class="font-normal">quiesce</span> method, which makes it
			            possible for your server domain to take reliable (backup)
			            snapshots with all the MySQL cogs suspended.</li> <li>If you apply my <a href="https://bugs.mysql.com/bug.php?id=75425" class="font-normal">MySQL patch</a> to v5.6 source code then your
			            (Perl, Python, PHP, …) code can access any version of MySQL
			            from v4.0 to v8.0. I believe this is the only means to achieve
			            that goal.</li></ul></div></section> <section id="git"><div class="section-header"><h2>Git</h2></div> <div><ul><li><a href="https://github.com/niczero/git-transplant" class="font-normal">git-transplant</a> can be very convenient when
			            you want to rewrite local Git commits, for example when you need
			            to reinstate timestamps, remove an erroneous file, or collapse an
			            experimental branch into something cleaner.</li> <li><a href="https://github.com/niczero/daggit" class="font-normal">daggit</a> is a javascript module for
			            rendering Git history into a beautiful colour-coded graph. This
			            will be incorporated into the forthcoming
			            <strong>git-surveillance</strong> which makes it easier to
			            understand and re-work complex Git trees.</li></ul></div></section> <section id="recipe"><div class="section-header"><h2>Recipe</h2></div> <p class="mb-8">Finally, it's always good to finish with a recipe.</p> <div class="recipe"><h3 class="mb-2">High-Protein Pancakes</h3> <div class="description"><p>This recipe was invented to provide extra protein for a child
			            with a restricted diet. These have a high egg content, so eat them
			            fresh rather than store them! Proportions here provide a meal for
			            two hungry children; perhaps if you divide by 3 it would suit a
			            pre-school child or a snack for someone older.</p></div> <div class="ingredients"><ol><li>180g plain flour (bread flour is even better)</li> <li>45ml sugar</li> <li>6ml baking powder</li> <li>3ml salt</li> <li>3 eggs</li> <li>150ml milk</li></ol></div> <div class="directions"><ol><li>Sift the dry ingredients into a large bowl.</li> <li>With a strong fork, stir in the eggs.</li> <li>Little by little, stir in the milk, avoiding the creation
			              of lumps.</li> <li>Leave it on the side for 5 minutes while you gently warm
			              (on a low heat) some oil in your pan. Dry away all the oil just
			              before the first pancake.</li> <li>As soon as the edges are solid enough, turn the pancake
			              over; don't wait for the top to cook dry.</li> <li>Serve with a moist topping, for example chopped fruits in
			              yoghurt.</li></ol></div></div></section> <section id="contact" class="contact"><div class="section-header"><h2>Get In Touch</h2></div> <div class="item flex"><div class="thumb flex-initial mb-8"><img src="img/code.jpg" srcset="img/code_2x.jpg 360w, img/code.jpg 180w" sizes="180px" width="180" height="80" alt="code"></div> <div class="text flex-1 ml-8 mb-8"><p>For feedback relating to CPAN or Github code, the best channel
			            is the 'issues' link for the particular module.</p></div></div> <div class="item flex"><div class="thumb flex-initial mb-8"><img src="img/chat.jpg" srcset="img/chat_2x.jpg 360w, img/chat.jpg 180w" sizes="180px" width="180" height="80" alt="IRC"></div> <div class="text flex-1 ml-8 mb-8"><p>I am often around on the <a href="https://kiwiirc.com/nextclient/#irc://irc.freenode.net/mojo?nick=visitor-?">Mojolicious
			            channel</a> in IRC.</p></div></div> <div class="item flex"><div class="thumb flex-initial mb-8"><img src="img/hire.jpg" srcset="img/hire_2x.jpg 360w, img/hire.jpg 180w" sizes="180px" width="180" height="80" alt="LinkedIn"></div> <div class="text flex-1 ml-8 mb-8"><p>Recruiters might be able to reach me via LinkedIn.</p></div></div></section> <section id="credits" class="credits"><div class="section-header"><h2>Acknowledgements</h2></div> <div class="text"><p>This page was implemented using <a href="https://svelte.dev">SvelteJS</a> and <a href="https://tailwindcss.com">TailwindCSS</a> based on a design licensed from <a href="https://themeforest.net/user/pxlsolutions/portfolio">PxlSolutions</a>.</p></div> <div class="text"><p>Stock photos by
			          <a href="https://unsplash.com/@markusspiske?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Markus Spiske</a>,
			          <a href="https://unsplash.com/@room?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">ROOM</a>,
			          and
			          <a href="https://unsplash.com/@clemono2?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Clem Onojeghuo</a>
			          on
			          <a href="https://unsplash.com?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText">Unsplash</a>.</p></div></section>`;
    			attr(div0, "class", "avatar mb-2");
    			attr(div1, "class", "name");
    			attr(a0, "aria-label", "Github");
    			attr(a0, "href", "https://github.com/niczero");
    			attr(li0, "class", "inline-block pr-2");
    			attr(a1, "aria-label", "CPAN");
    			attr(a1, "href", "https://metacpan.org/author/NICZERO");
    			attr(li1, "class", "inline-block pr-2");
    			attr(a2, "aria-label", "LinkedIn");
    			attr(a2, "href", "https://uk.linkedin.com/in/niczero");
    			attr(li2, "class", "inline-block pr-2");
    			attr(a3, "aria-label", "StackOverflow");
    			attr(a3, "href", "https://stackoverflow.com/users/891516/niczero");
    			attr(li3, "class", "inline-block pr-2");
    			attr(a4, "aria-label", "Twitter");
    			attr(a4, "href", "https://twitter.com/nic_sandfield");
    			attr(li4, "class", "inline-block pr-2");
    			attr(div2, "class", "social");
    			attr(a5, "href", "#intro");
    			toggle_class(a5, "active", ctx.section === 'intro');
    			attr(a6, "href", "#perl");
    			toggle_class(a6, "active", ctx.section === 'perl');
    			attr(a7, "href", "#mysql");
    			toggle_class(a7, "active", ctx.section === 'mysql');
    			attr(a8, "href", "#git");
    			toggle_class(a8, "active", ctx.section === 'git');
    			attr(a9, "href", "#recipe");
    			toggle_class(a9, "active", ctx.section === 'recipe');
    			attr(a10, "href", "#contact");
    			toggle_class(a10, "active", ctx.section === 'contact');
    			attr(ul1, "class", "text-xs");
    			attr(nav, "class", "mt-8");
    			attr(div3, "class", "copyright mt-20 text-xs");
    			attr(div30, "class", "wrapper-inner");
    			attr(div31, "class", "wrapper");

    			dispose = [
    				listen(a5, "click", ctx.click_handler),
    				listen(a6, "click", ctx.click_handler_1),
    				listen(a7, "click", ctx.click_handler_2),
    				listen(a8, "click", ctx.click_handler_3),
    				listen(a9, "click", ctx.click_handler_4),
    				listen(a10, "click", ctx.click_handler_5)
    			];
    		},

    		m(target, anchor) {
    			insert(target, div31, anchor);
    			append(div31, div30);
    			append(div30, header);
    			append(header, div0);
    			append(header, t0);
    			append(header, div1);
    			append(header, t4);
    			append(header, div2);
    			append(div2, ul0);
    			append(ul0, li0);
    			append(li0, a0);
    			mount_component(icon0, a0, null);
    			append(ul0, t5);
    			append(ul0, li1);
    			append(li1, a1);
    			mount_component(icon1, a1, null);
    			append(ul0, t6);
    			append(ul0, li2);
    			append(li2, a2);
    			mount_component(icon2, a2, null);
    			append(ul0, t7);
    			append(ul0, li3);
    			append(li3, a3);
    			mount_component(icon3, a3, null);
    			append(ul0, t8);
    			append(ul0, li4);
    			append(li4, a4);
    			mount_component(icon4, a4, null);
    			append(header, t9);
    			append(header, nav);
    			append(nav, ul1);
    			append(ul1, li5);
    			append(li5, a5);
    			append(ul1, t11);
    			append(ul1, li6);
    			append(li6, a6);
    			append(ul1, t13);
    			append(ul1, li7);
    			append(li7, a7);
    			append(ul1, t15);
    			append(ul1, li8);
    			append(li8, a8);
    			append(ul1, t17);
    			append(ul1, li9);
    			append(li9, a9);
    			append(ul1, t19);
    			append(ul1, li10);
    			append(li10, a10);
    			append(header, t21);
    			append(header, div3);
    			append(div30, t22);
    			append(div30, main);
    			current = true;
    		},

    		p(changed, ctx) {
    			var icon0_changes = {};
    			if (changed.faGithub) icon0_changes.icon = faGithub;
    			icon0.$set(icon0_changes);

    			var icon1_changes = {};
    			if (changed.faSith) icon1_changes.icon = faSith;
    			icon1.$set(icon1_changes);

    			var icon2_changes = {};
    			if (changed.faLinkedin) icon2_changes.icon = faLinkedin;
    			if (changed.$$scope) icon2_changes.$$scope = { changed, ctx };
    			icon2.$set(icon2_changes);

    			var icon3_changes = {};
    			if (changed.faStackOverflow) icon3_changes.icon = faStackOverflow;
    			icon3.$set(icon3_changes);

    			var icon4_changes = {};
    			if (changed.faTwitter) icon4_changes.icon = faTwitter;
    			icon4.$set(icon4_changes);

    			if (changed.section) {
    				toggle_class(a5, "active", ctx.section === 'intro');
    				toggle_class(a6, "active", ctx.section === 'perl');
    				toggle_class(a7, "active", ctx.section === 'mysql');
    				toggle_class(a8, "active", ctx.section === 'git');
    				toggle_class(a9, "active", ctx.section === 'recipe');
    				toggle_class(a10, "active", ctx.section === 'contact');
    			}
    		},

    		i(local) {
    			if (current) return;
    			transition_in(icon0.$$.fragment, local);

    			transition_in(icon1.$$.fragment, local);

    			transition_in(icon2.$$.fragment, local);

    			transition_in(icon3.$$.fragment, local);

    			transition_in(icon4.$$.fragment, local);

    			current = true;
    		},

    		o(local) {
    			transition_out(icon0.$$.fragment, local);
    			transition_out(icon1.$$.fragment, local);
    			transition_out(icon2.$$.fragment, local);
    			transition_out(icon3.$$.fragment, local);
    			transition_out(icon4.$$.fragment, local);
    			current = false;
    		},

    		d(detaching) {
    			if (detaching) {
    				detach(div31);
    			}

    			destroy_component(icon0, );

    			destroy_component(icon1, );

    			destroy_component(icon2, );

    			destroy_component(icon3, );

    			destroy_component(icon4, );

    			run_all(dispose);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	

    let section = 'intro';

    // onMount(async () => {
    //   let el = document.querySelector('.wrapper-inner');
    //   console.log(el);
    //   SimpleScrollbar.initEl(el);
    // });

    	function click_handler() {
    		const $$result = section = 'intro';
    		$$invalidate('section', section);
    		return $$result;
    	}

    	function click_handler_1() {
    		const $$result = section = 'perl';
    		$$invalidate('section', section);
    		return $$result;
    	}

    	function click_handler_2() {
    		const $$result = section = 'mysql';
    		$$invalidate('section', section);
    		return $$result;
    	}

    	function click_handler_3() {
    		const $$result = section = 'git';
    		$$invalidate('section', section);
    		return $$result;
    	}

    	function click_handler_4() {
    		const $$result = section = 'recipe';
    		$$invalidate('section', section);
    		return $$result;
    	}

    	function click_handler_5() {
    		const $$result = section = 'contact';
    		$$invalidate('section', section);
    		return $$result;
    	}

    	return {
    		section,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3,
    		click_handler_4,
    		click_handler_5
    	};
    }

    class Index extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, []);
    	}
    }

    const index = new Index({
      target: document.body
    });

    return index;

}());
//# sourceMappingURL=niczero.js.map

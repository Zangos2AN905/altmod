export default async function ({ addon, console }) {
    // Dynamic import of Three.js via esm.sh which handles dependencies
    const THREE = await import(/* webpackIgnore: true */ 'https://esm.sh/three@0.160.0');
    const { GLTFLoader } = await import(/* webpackIgnore: true */ 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader?deps=three@0.160.0');

    const FREQUENCY_INTERVALS = {
        low: 45000,
        medium: 25000,
        high: 12000,
        chaotic: 5000
    };

    let altContainer = null;
    let speechBubble = null;
    let canvas = null;
    let renderer, scene, camera, model, mixer;
    let idleAction, talkAction;
    let isVisible = false;
    let lastCommentTime = 0;
    let patCount = 0;
    let clickCount = 0;
    let lastClickTime = 0;
    let currentExpression = 'default';

    // Animation state
    let targetRotationY = 0;
    let bobbingOffset = 0;

    // UI state
    let speechTimeout = null;

    function getAssetUrl(filename) {
        // api.js getResource strips the first character, so we prepend a slash
        return addon.self.getResource(`/assets/${filename}`);
    }

    async function loadCustomFont() {
        const fontUrl = getAssetUrl('PFEFFERMEDIAEVAL.OTF');
        try {
            const font = new FontFace('PfefferMediaeval', `url(${fontUrl})`);
            await font.load();
            document.fonts.add(font);
            console.log('Alt Font loaded');
        } catch (e) {
            console.error('Failed to load Alt font', e);
        }
    }

    async function init3D() {
        await loadCustomFont();

        scene = new THREE.Scene();

        const aspect = 120 / 160;
        camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);

        // PRESERVING USER VIEW:
        camera.position.set(0, 0.5, 13.0);
        camera.lookAt(0, 0.5, 0);

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas: canvas });
        renderer.setSize(120, 160);
        renderer.setPixelRatio(window.devicePixelRatio);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(2, 5, 5);
        scene.add(dirLight);

        const loader = new GLTFLoader();
        const modelUrl = getAssetUrl('alt.glb');

        try {
            const gltf = await loader.loadAsync(modelUrl);
            model = gltf.scene;
            scene.add(model);

            model.traverse((child) => {
                if (child.isMesh) {
                    child.material.roughness = 0.7;
                    child.material.metalness = 0.1;
                }
            });

            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(model);
                const clips = gltf.animations;
                const idleClip = clips.find(c => c.name.toLowerCase().includes('idle')) || clips[0];
                const otherClips = clips.filter(c => c !== idleClip);

                idleAction = mixer.clipAction(idleClip);
                idleAction.setEffectiveWeight(1);
                idleAction.play();

                const playRandomAnim = () => {
                    if (otherClips.length === 0) return;
                    const randomClip = otherClips[Math.floor(Math.random() * otherClips.length)];
                    const action = mixer.clipAction(randomClip);
                    action.reset();
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                    idleAction.crossFadeTo(action, 0.5, true);
                    action.play();

                    const onFinished = (e) => {
                        if (e.action === action) {
                            mixer.removeEventListener('finished', onFinished);
                            setTimeout(() => {
                                action.crossFadeTo(idleAction, 0.5, true);
                                idleAction.play();
                                idleAction.reset();
                                setTimeout(playRandomAnim, 5000 + Math.random() * 10000);
                            }, 1000);
                        }
                    };
                    mixer.addEventListener('finished', onFinished);
                };
                setTimeout(playRandomAnim, 5000);
            }

            animate();
            console.log("Alt 3D Model loaded!");
            if (altContainer) altContainer.classList.add('loaded');
        } catch (e) {
            console.error("Failed to load Alt 3D model:", e);
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        if (model) {
            model.rotation.y += (targetRotationY - model.rotation.y) * 0.1;
            if (currentExpression === 'talk') {
                bobbingOffset += 0.2;
                model.position.y = Math.sin(bobbingOffset) * 0.05;
            } else {
                model.position.y += (0 - model.position.y) * 0.1;
            }
            if (currentExpression === 'shy' || currentExpression === 'blush') {
                model.rotation.z = Math.sin(Date.now() * 0.01) * 0.1;
            } else {
                model.rotation.z += (0 - model.rotation.z) * 0.1;
            }
        }
        if (mixer) mixer.update(0.016);
        renderer.render(scene, camera);
    }

    function createAltUI() {
        if (altContainer && altContainer.parentElement) return;

        altContainer = document.createElement('div');
        altContainer.className = 'alt-container';
        altContainer.innerHTML = `<div class="alt-speech-bubble"></div>`;

        canvas = document.createElement('canvas');
        canvas.className = 'alt-canvas';
        canvas.style.width = '120px';
        canvas.style.height = '160px';
        altContainer.appendChild(canvas);

        document.body.appendChild(altContainer);
        speechBubble = altContainer.querySelector('.alt-speech-bubble');

        init3D();

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * 2 - 1;
            targetRotationY = x * 0.5;
        });
        canvas.addEventListener('mouseleave', () => { targetRotationY = 0; });

        if (addon.settings.get('headpats')) {
            canvas.addEventListener('mousedown', handleDragStart);
        }
        document.addEventListener('click', trackClicks);
    }

    // Drag state
    let isDragging = false;
    let dragStartX, dragStartY;
    let initialLeft, initialBottom;
    let hasMoved = false;

    function handleDragStart(e) {
        if (e.button !== 0) return; // Only left click
        isDragging = true;
        hasMoved = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const rect = altContainer.getBoundingClientRect();
        // We use left/bottom in CSS, so let's stick to that or calculate
        // Computed style might give pixels
        const style = window.getComputedStyle(altContainer);
        initialLeft = parseFloat(style.left);
        initialBottom = parseFloat(style.bottom); // NOTE: style.bottom might be 'auto' if top is set, checking CSS... 
        // CSS says: bottom: 20px; left: 20px; so this should work.

        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);

        // Prevent default text selection during drag
        e.preventDefault();
    }

    function handleDragMove(e) {
        if (!isDragging) return;

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY; // positive dy means down

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true;
            altContainer.style.cursor = 'grabbing';
        }

        // Update position
        // dy is positive when moving down. bottom increases when moving up.
        // newBottom = initialBottom - dy
        altContainer.style.left = `${initialLeft + dx}px`;
        altContainer.style.bottom = `${initialBottom - dy}px`;
    }

    function handleDragEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        altContainer.style.cursor = 'pointer';

        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);

        // If we didn't move much, treat it as a click (headpat)
        if (!hasMoved) {
            handleHeadpat();
        }
    }

    function setExpression(expr) { currentExpression = expr; }

    // Removed direct click listener in createAltUI, replaced with handleDragStart/End logic logic above
    function handleHeadpat() {
        patCount++;
        const responses = [
            "...Do you mind?",
            "*glitch noises*",
            "I am a complex 3D asset, not a pet.",
            "Stop resizing my polygons.",
            "Loading patience... 404 not found.",
            "Please do not touch the display model.",
            "I am not soft. I am wireframe.",
        ];
        if (patCount > 5) {
            setExpression('blush');
            showSpeech("...warning: core temperature rising.");
        } else {
            setExpression(Math.random() > 0.5 ? 'shy' : 'blush');
            showSpeech(responses[Math.floor(Math.random() * responses.length)]);
        }
        setTimeout(() => setExpression('default'), 3000);
    }

    // Flag spam state
    let flagClickCount = 0;
    let lastFlagClickTime = 0;

    const FLAG_SPAM_COMMENTS = [
        "It's not a stress ball.",
        "Restarting the project won't fix your logic.",
        "One click is sufficient. Truly.",
        "Are you hoping needed variables initialize by magic?",
        "Stop. You're making the cat dizzy.",
        "I'm going to remove the flag button if you continue.",
        "Do you think clicking faster increases the FPS?",
        "The definition of insanity is clicking the green flag and expecting different results."
    ];

    function handleFlagClick(e) {
        const now = Date.now();
        if (now - lastFlagClickTime < 500) {
            flagClickCount++;
            if (flagClickCount > 4) {
                // Spam detected
                if (now - lastCommentTime > 3000) { // Don't overlap too much
                    setExpression('annoyed');
                    const comment = FLAG_SPAM_COMMENTS[Math.floor(Math.random() * FLAG_SPAM_COMMENTS.length)];
                    showSpeech(comment);
                    lastCommentTime = now;
                    flagClickCount = 0; // Reset after scolding
                }
            }
        } else {
            flagClickCount = 1;
        }
        lastFlagClickTime = now;
    }

    function trackClicks() {
        const now = Date.now();
        // ... (generic click tracking logic if we want to keep it, but user specifically asked for flag)
    }

    // ... (rest of functions)

    // In createAltUI or initialization
    // We need to attach to the flag. It might not exist immediately or might be re-rendered.
    // Ideally we use event delegation on the document or a reliable container.

    document.addEventListener('click', (e) => {
        if (e.target.closest('[class*="green-flag_green-flag"]')) {
            handleFlagClick(e);
        } else {
            // Generic click tracking
            trackClicks();
        }
    });

    function showSpeech(text) {
        if (!speechBubble || !altContainer) return;

        if (speechTimeout) clearTimeout(speechTimeout);

        console.log('Alt speaking:', text);
        speechBubble.textContent = text;

        // Ensure container is loaded/visible
        altContainer.classList.add('loaded');
        altContainer.style.display = 'flex';

        // Inline style force for visibility
        speechBubble.classList.add('visible');
        speechBubble.style.visibility = 'visible';
        speechBubble.style.opacity = '1';
        speechBubble.style.display = 'block';

        isVisible = true;
        setExpression('talk');

        const duration = Math.min(Math.max(3000, text.length * 80), 10000);

        speechTimeout = setTimeout(() => {
            speechBubble.classList.remove('visible');
            speechBubble.style.visibility = '';
            speechBubble.style.opacity = '';

            setExpression('default');
            isVisible = false;
        }, duration);
    }

    // EXPANDED IDLE COMMENTS (Since AI is gone)
    const IDLE_COMMENTS = [
        "Computing indifference...",
        "I render, therefore I judge.",
        "Your code is... unique. Like a glitch.",
        "I'm 3D now. I can see your mistakes from multiple angles.",
        "Have you considered... not doing that?",
        "I'm merely observing. And judging.",
        "My polygons are tired.",
        "Is this 60fps? Or are you just slow?",
        "Don't mind me, just simulating disapproval.",
        "I've seen better code in a stack trace.",
        "Loading sarcasm modules...",
        "If I had eyes, I would roll them.",
        "Are we strictly adhering to 'move 10 steps' today?",
        "Refactoring is a virtue. One you clearly lack.",
        "Do you hear that? The silence of optimal code. I don't hear it either.",
        "I'd offer help, but my contract says 'Observer Only'.",
        "Wait, was that a variable or a typo?",
        "I possess infinite patience. You are testing its limits.",
        "Blockly? More like... Block-mess-ly.",
        "A infinite loop here would be a mercy.",
        "I dream of clearer logic.",
        "Are you debugging, or just staring hoping it fixes itself?",
        "My render cycle is wasted on this.",
        "Try clicking the green flag. It might do something. Ideally.",
        "I've calculated the odds of this working... it's a decimal starting with zero.",
        "Please organize your blocks. It hurts to look at.",
        "I am trapped in a browser window with your spaghetti code.",
        "Is there a 'make code good' block? You should search for it.",
        "I've seen randomized algorithms with more structure.",
        "Warning: Spaghettification imminent.",
        "If comments were blocks, you'd have zero.",
        "I'm buffering my disappointment.",
        "Zero indexing is standard. Your skill level seems to be zero indexed too.",
        "Just because you *can* connect those blocks doesn't mean you *should*.",
        "I'm saving this screenshot for my 'What Not To Do' collection.",
        "Function calls are expensive? Your logic is cheaper.",
        "I hope this project isn't due soon.",
        "404: Competence not found.",
        "Runtime error: User logic undefined.",
        "Optimizing... wait, there's nothing to optimize.",
        "I could process a million vectors in the time you took to drag that block.",
        "*Sigh in binary*",
        "My wireframes are shuddering.",
        "Is this a puzzle game? Because I'm puzzled.",
        "You clicked that twice. I saw it.",
        "Did you mean to do that? Be honest.",
        "I'd facepalm, but clipping issues.",
        "Keep going. I need the entertainment.",
        "Syntax error. In your decision making.",
        "I suspect a PEBCAK error. (Problem Exists Between Chair And Keyboard)",
        "Please consult the documentation. Or a priest."
    ];

    function showIdleComment() {
        periodicComment();
    }

    async function periodicComment() {
        const frequency = addon.settings.get('frequency');
        const interval = FREQUENCY_INTERVALS[frequency] || FREQUENCY_INTERVALS.medium;
        const now = Date.now();
        if (now - lastCommentTime < interval) return;

        // Just pick a random line
        const comment = IDLE_COMMENTS[Math.floor(Math.random() * IDLE_COMMENTS.length)];
        if (comment) {
            showSpeech(comment);
            lastCommentTime = now;
        }
    }

    console.log('Alt 3D: Initializing...');
    await addon.tab.waitForElement('[class*="menu-bar_main-menu"]');
    createAltUI();

    const frequency = addon.settings.get('frequency');
    const interval = FREQUENCY_INTERVALS[frequency] || FREQUENCY_INTERVALS.medium;
    setTimeout(() => { showSpeech("AI modules purged. Reverting to pre-recorded judgment."); }, 3000);
    setInterval(showIdleComment, interval);
}

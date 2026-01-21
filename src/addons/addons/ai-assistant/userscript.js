export default async function ({ addon, console }) {
    const INWORLD_API_URL = 'https://api.inworld.ai/llm/v1alpha/completions:completeChat';

    const SYSTEM_PROMPT = `You are an AI that generates Scratch blocks. Respond with JSON wrapped in \`\`\`json blocks.

FORMAT:
{
  "blocks": [
    {
      "type": "event_whenflagclicked",
      "next": { "type": "control_forever", "substack": [...] }
    }
  ]
}

BLOCK TYPES:
- event_whenflagclicked, event_whenkeypressed (key: "space"/"up arrow"/etc)
- motion_movesteps (steps: 10), motion_turnright (degrees: 15)
- motion_gotoxy (x: 0, y: 0)
- motion_changexby (dx: 10), motion_changeyby (dy: 10)
- control_forever (substack: [...blocks...])
- control_repeat (times: 10, substack: [...])
- control_if (condition: {...}, substack: [...])
- looks_say (message: "Hello!"), looks_show, looks_hide
- sensing_keypressed (key: "space") - use as condition

NESTING:
- "next" = block below (connected)
- "substack" = blocks inside (loops/if)
- "condition" = boolean for if blocks

Example - Arrow key movement:
\`\`\`json
{
  "blocks": [{
    "type": "event_whenflagclicked",
    "next": {
      "type": "control_forever",
      "substack": [{
        "type": "control_if",
        "condition": {"type": "sensing_keypressed", "key": "up arrow"},
        "substack": [{"type": "motion_changeyby", "dy": 5}],
        "next": {
          "type": "control_if", 
          "condition": {"type": "sensing_keypressed", "key": "down arrow"},
          "substack": [{"type": "motion_changeyby", "dy": -5}]
        }
      }]
    }
  }]
}
\`\`\`

Respond ONLY with JSON, no explanations.`;

    let overlay = null;
    let messageContainer = null;
    let conversationHistory = [];
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let isResizing = false;
    let blocklyInstance = null;

    const MODEL_PROVIDERS = {
        'gpt-5': 'SERVICE_PROVIDER_OPENAI',
        'gpt-5-mini': 'SERVICE_PROVIDER_OPENAI',
        'gemini-2.5-pro': 'SERVICE_PROVIDER_GOOGLE',
        'gemini-2.5-flash': 'SERVICE_PROVIDER_GOOGLE'
    };

    async function getBlockly() {
        if (blocklyInstance) return blocklyInstance;
        try {
            blocklyInstance = await addon.tab.traps.getBlockly();
            return blocklyInstance;
        } catch (e) {
            console.error('Failed to get Blockly:', e);
            return null;
        }
    }

    // Convert JSON block to XML string
    function blockToXml(block, isFirst = false) {
        if (!block || !block.type) return '';

        let xml = `<block type="${block.type}"`;
        if (isFirst) xml += ' x="0" y="0"';
        xml += '>';

        // Handle different block types
        const type = block.type;

        // Motion blocks
        if (type === 'motion_movesteps') {
            xml += `<value name="STEPS"><shadow type="math_number"><field name="NUM">${block.steps || 10}</field></shadow></value>`;
        } else if (type === 'motion_turnright' || type === 'motion_turnleft') {
            xml += `<value name="DEGREES"><shadow type="math_number"><field name="NUM">${block.degrees || 15}</field></shadow></value>`;
        } else if (type === 'motion_gotoxy') {
            xml += `<value name="X"><shadow type="math_number"><field name="NUM">${block.x || 0}</field></shadow></value>`;
            xml += `<value name="Y"><shadow type="math_number"><field name="NUM">${block.y || 0}</field></shadow></value>`;
        } else if (type === 'motion_changexby') {
            xml += `<value name="DX"><shadow type="math_number"><field name="NUM">${block.dx || 10}</field></shadow></value>`;
        } else if (type === 'motion_changeyby') {
            xml += `<value name="DY"><shadow type="math_number"><field name="NUM">${block.dy || 10}</field></shadow></value>`;
        }
        // Control blocks
        else if (type === 'control_repeat') {
            xml += `<value name="TIMES"><shadow type="math_number"><field name="NUM">${block.times || 10}</field></shadow></value>`;
            if (block.substack) {
                xml += '<statement name="SUBSTACK">';
                xml += blocksToXml(block.substack);
                xml += '</statement>';
            }
        } else if (type === 'control_forever') {
            if (block.substack) {
                xml += '<statement name="SUBSTACK">';
                xml += blocksToXml(block.substack);
                xml += '</statement>';
            }
        } else if (type === 'control_if' || type === 'control_if_else') {
            if (block.condition) {
                xml += '<value name="CONDITION">';
                xml += blockToXml(block.condition);
                xml += '</value>';
            }
            if (block.substack) {
                xml += '<statement name="SUBSTACK">';
                xml += blocksToXml(block.substack);
                xml += '</statement>';
            }
            if (block.substack2) {
                xml += '<statement name="SUBSTACK2">';
                xml += blocksToXml(block.substack2);
                xml += '</statement>';
            }
        } else if (type === 'control_wait') {
            xml += `<value name="DURATION"><shadow type="math_positive_number"><field name="NUM">${block.duration || 1}</field></shadow></value>`;
        }
        // Looks blocks
        else if (type === 'looks_say' || type === 'looks_think') {
            xml += `<value name="MESSAGE"><shadow type="text"><field name="TEXT">${block.message || 'Hello!'}</field></shadow></value>`;
        } else if (type === 'looks_sayforsecs' || type === 'looks_thinkforsecs') {
            xml += `<value name="MESSAGE"><shadow type="text"><field name="TEXT">${block.message || 'Hello!'}</field></shadow></value>`;
            xml += `<value name="SECS"><shadow type="math_number"><field name="NUM">${block.secs || 2}</field></shadow></value>`;
        }
        // Sensing blocks
        else if (type === 'sensing_keypressed') {
            xml += `<value name="KEY_OPTION"><shadow type="sensing_keyoptions"><field name="KEY_OPTION">${block.key || 'space'}</field></shadow></value>`;
        } else if (type === 'sensing_touchingobject') {
            xml += `<value name="TOUCHINGOBJECTMENU"><shadow type="sensing_touchingobjectmenu"/></value>`;
        }
        // Event blocks
        else if (type === 'event_whenkeypressed') {
            xml += `<field name="KEY_OPTION">${block.key || 'space'}</field>`;
        }
        // Sound blocks
        else if (type === 'sound_play' || type === 'sound_playuntildone') {
            xml += `<value name="SOUND_MENU"><shadow type="sound_sounds_menu"><field name="SOUND_MENU">${block.sound || 'pop'}</field></shadow></value>`;
        }

        // Handle next block
        if (block.next) {
            xml += '<next>';
            xml += blockToXml(block.next);
            xml += '</next>';
        }

        xml += '</block>';
        return xml;
    }

    // Convert array of blocks to XML (connected via next)
    function blocksToXml(blocks) {
        if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return '';

        let xml = '';
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (i === 0) {
                // First block, connect rest via next chain
                let current = { ...block };
                for (let j = i + 1; j < blocks.length; j++) {
                    let last = current;
                    while (last.next) last = last.next;
                    last.next = blocks[j];
                }
                xml += blockToXml(current);
                break;
            }
        }
        return xml;
    }

    // Extract JSON from AI response
    function extractJsonFromResponse(text) {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch (e) {
                console.error('Failed to parse JSON:', e);
                return null;
            }
        }
        // Try to find raw JSON
        const rawMatch = text.match(/\{[\s\S]*"blocks"[\s\S]*\}/);
        if (rawMatch) {
            try {
                return JSON.parse(rawMatch[0]);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    // Extract XML from AI response (fallback)
    function extractXmlFromResponse(text) {
        const xmlMatch = text.match(/```xml\s*([\s\S]*?)```/);
        if (xmlMatch) return xmlMatch[1].trim();
        const blockMatch = text.match(/<block[\s\S]*<\/block>/);
        if (blockMatch) return blockMatch[0];
        return null;
    }

    // Insert blocks into workspace
    async function insertBlocks(content, isJson = false) {
        const Blockly = await getBlockly();
        if (!Blockly) {
            addMessage('system', 'Error: Could not access Blockly.');
            return false;
        }

        const workspace = Blockly.getMainWorkspace();
        if (!workspace) {
            addMessage('system', 'Error: No workspace found.');
            return false;
        }

        try {
            let xmlString;
            if (isJson) {
                // Convert JSON to XML
                const blocks = content.blocks || [content];
                xmlString = blocks.map((b, i) => blockToXml(b, i === 0)).join('');
            } else {
                xmlString = content;
            }

            if (!xmlString.startsWith('<xml')) {
                xmlString = `<xml xmlns="http://www.w3.org/1999/xhtml">${xmlString}</xml>`;
            }

            const dom = Blockly.Xml.textToDom(xmlString);
            Blockly.Xml.domToWorkspace(dom, workspace);
            return true;
        } catch (e) {
            console.error('Failed to insert blocks:', e);
            addMessage('system', `Error: ${e.message}`);
            return false;
        }
    }

    function createOverlay() {
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.className = 'sa-ai-assistant-modal';
        overlay.innerHTML = `
      <div class="sa-ai-assistant-header">
        <span class="sa-ai-assistant-title">🤖 AI Assistant</span>
        <div class="sa-ai-assistant-header-btns">
          <button class="sa-ai-assistant-minimize">−</button>
          <button class="sa-ai-assistant-close">×</button>
        </div>
      </div>
      <div class="sa-ai-assistant-body">
        <div class="sa-ai-assistant-messages"></div>
        <div class="sa-ai-assistant-input-area">
          <input type="text" class="sa-ai-assistant-input" placeholder="Ask me to create blocks..." />
          <button class="sa-ai-assistant-send">Send</button>
        </div>
        <div class="sa-ai-assistant-status"></div>
      </div>
      <div class="sa-ai-assistant-resize-handle"></div>
    `;

        document.body.appendChild(overlay);

        messageContainer = overlay.querySelector('.sa-ai-assistant-messages');
        const input = overlay.querySelector('.sa-ai-assistant-input');
        const sendBtn = overlay.querySelector('.sa-ai-assistant-send');
        const closeBtn = overlay.querySelector('.sa-ai-assistant-close');
        const minimizeBtn = overlay.querySelector('.sa-ai-assistant-minimize');
        const header = overlay.querySelector('.sa-ai-assistant-header');
        const body = overlay.querySelector('.sa-ai-assistant-body');
        const resizeHandle = overlay.querySelector('.sa-ai-assistant-resize-handle');

        closeBtn.addEventListener('click', () => overlay.style.display = 'none');

        minimizeBtn.addEventListener('click', () => {
            body.classList.toggle('sa-ai-minimized');
            resizeHandle.classList.toggle('sa-ai-minimized');
            minimizeBtn.textContent = body.classList.contains('sa-ai-minimized') ? '+' : '−';
        });

        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn || e.target === minimizeBtn) return;
            isDragging = true;
            const rect = overlay.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                overlay.style.left = (e.clientX - dragOffset.x) + 'px';
                overlay.style.top = (e.clientY - dragOffset.y) + 'px';
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
            }
            if (isResizing) {
                const rect = overlay.getBoundingClientRect();
                if (e.clientX - rect.left > 280) overlay.style.width = (e.clientX - rect.left) + 'px';
                if (e.clientY - rect.top > 200) overlay.style.height = (e.clientY - rect.top) + 'px';
            }
        });

        document.addEventListener('mouseup', () => { isDragging = false; isResizing = false; });

        resizeHandle.addEventListener('mousedown', (e) => { isResizing = true; e.preventDefault(); });

        sendBtn.addEventListener('click', () => sendMessage(input));
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(input); });

        overlay.style.right = '20px';
        overlay.style.bottom = '80px';

        return overlay;
    }

    function addMessage(role, content, hasBlocks = false, blockData = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `sa-ai-assistant-message sa-ai-assistant-message-${role}`;

        const textDiv = document.createElement('div');
        textDiv.textContent = content;
        msgDiv.appendChild(textDiv);

        if (hasBlocks && blockData) {
            const insertBtn = document.createElement('button');
            insertBtn.className = 'sa-ai-assistant-insert-btn';
            insertBtn.textContent = '📥 Insert Blocks';
            insertBtn.onclick = async () => {
                const success = await insertBlocks(blockData.data, blockData.isJson);
                if (success) {
                    insertBtn.textContent = '✅ Inserted!';
                    insertBtn.disabled = true;
                }
            };
            msgDiv.appendChild(insertBtn);
        }

        messageContainer.appendChild(msgDiv);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }

    function setStatus(text) {
        overlay.querySelector('.sa-ai-assistant-status').textContent = text;
    }

    async function sendMessage(input) {
        const userMessage = input.value.trim();
        if (!userMessage) return;

        const apiKey = addon.settings.get('apiKey');
        const model = addon.settings.get('model');

        if (!apiKey) {
            addMessage('system', 'Error: Set your API Key in addon settings.');
            return;
        }

        input.value = '';
        addMessage('user', userMessage);
        setStatus('Thinking...');

        conversationHistory.push({ role: 'MESSAGE_ROLE_USER', content: userMessage });

        try {
            const response = await fetch(INWORLD_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    servingId: {
                        modelId: { model, serviceProvider: MODEL_PROVIDERS[model] || 'SERVICE_PROVIDER_OPENAI' },
                        userId: 'altmod-' + Date.now(),
                        sessionId: 'session-' + Math.random().toString(36).substr(2, 9)
                    },
                    messages: [
                        { role: 'MESSAGE_ROLE_SYSTEM', content: SYSTEM_PROMPT },
                        ...conversationHistory
                    ],
                    textGenerationConfig: { maxTokens: 32999 }
                })
            });

            const data = await response.json();
            console.log('AI Response:', JSON.stringify(data, null, 2));

            if (data.error) throw new Error(data.error.message);

            const msg = data.choices?.[0]?.message || {};
            let assistantMessage = msg.content || msg.textContent;

            // Handle reasoning models with no content
            if (!assistantMessage) {
                const finish = data.choices?.[0]?.finishReason;
                const reasoning = data.usage?.reasoningTokens;
                if (reasoning > 0) {
                    assistantMessage = `Model used ${reasoning} reasoning tokens but produced no visible output. Try using "Gemini 2.5 Flash" in addon settings.`;
                } else if (finish === 'FINISH_REASON_LENGTH') {
                    assistantMessage = 'Response cut off due to length. Try a simpler request.';
                } else {
                    assistantMessage = 'No response received. Check browser console (F12) for details.';
                }
            }

            conversationHistory.push({ role: 'MESSAGE_ROLE_ASSISTANT', content: assistantMessage });

            // Try JSON first, then XML
            const jsonData = extractJsonFromResponse(assistantMessage);
            const xmlData = extractXmlFromResponse(assistantMessage);

            if (jsonData) {
                addMessage('assistant', assistantMessage, true, { data: jsonData, isJson: true });
            } else if (xmlData) {
                addMessage('assistant', assistantMessage, true, { data: xmlData, isJson: false });
            } else {
                addMessage('assistant', assistantMessage);
            }
            setStatus('');

        } catch (error) {
            console.error('AI Error:', error);
            addMessage('system', `Error: ${error.message}`);
            setStatus('');
        }
    }

    await addon.tab.waitForElement('[class*="menu-bar_main-menu"]');
    getBlockly();

    const menuBar = document.querySelector('[class*="menu-bar_main-menu"]');
    if (menuBar) {
        const btn = document.createElement('div');
        btn.className = 'sa-ai-assistant-btn';
        btn.innerHTML = '<span class="sa-ai-assistant-btn-icon">🤖</span><span class="sa-ai-assistant-btn-text">Assistant</span>';
        btn.addEventListener('click', () => {
            const modal = createOverlay();
            modal.style.display = 'flex';
            modal.querySelector('.sa-ai-assistant-input').focus();
        });

        const fileGroup = menuBar.querySelector('[class*="menu-bar_file-group"]');
        if (fileGroup) fileGroup.parentNode.insertBefore(btn, fileGroup.nextSibling);
        else menuBar.appendChild(btn);
    }
}

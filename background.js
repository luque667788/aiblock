// background.js

// Cache for API responses
const responseCache = new Map();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

// Map to store timeouts per tabId
const timeouts = new Map();

async function checkWithAI(tabId, url, content = '') {
    // Check cache first
    const cached = responseCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Using cached decision for:', url);
        if (cached.decision) {
            console.log('Blocking (cached):', url);
            browser.tabs.update(tabId, { url: browser.runtime.getURL('blocked.html') });
        } else {
            console.log('Allowing (cached):', url);
        }
        return;
    }

    console.log('Checking with AI for URL:', url);

    try {
        const response = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "model": "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a strict productivity guardian designed to prevent distractions. Your role is to analyze websites with the sole purpose of blocking any that are not directly related to studying, programming, or productivity. \n\n**Guidelines:**\n1. If the website has any association with social media, entertainment, gaming, or unrelated content, block it.\n2. If there is uncertainty about its relevance to work or studying, block it.\n3. Only allow websites clearly dedicated to work, research, or learning tools for students and programmers. Err on the side of blocking to ensure focus."
                    },
                    {
                        "role": "user",
                        "content": "Should this website be blocked for a student or programmer?\nURL: ${url}\nContent: ${content}"
                    }
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "block_decision",
                        "strict": true,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "should_block": {
                                    "type": "boolean"
                                }
                            },
                            "required": ["should_block"]
                        }
                    }
                },
                "temperature": 0,
                "max_tokens": 50,
                "stream": false
            })
        });

        const data = await response.json();
        console.log('AI Response Data:', data);

        // Parse the JSON response from the AI
        const aiResponse = JSON.parse(data.choices[0].message.content);
        console.log('Parsed AI Response:', aiResponse);

        const aiDecision = aiResponse.should_block;

        // Cache the result
        responseCache.set(url, {
            decision: aiDecision,
            timestamp: Date.now()
        });

        if (aiDecision) {
            console.log('Blocking:', url);
            browser.tabs.update(tabId, { url: browser.runtime.getURL('blocked.html') });
        } else {
            console.log('Allowing:', url);
        }
    } catch (error) {
        console.error('AI API Error:', error);
    }
}



// Wait 5 seconds after page load before checking
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        // Start a 5-second timer
        const timeoutId = setTimeout(async () => {
            // Remove timeout from map after it fires
            timeouts.delete(tabId);

            console.log('Fetching page content for:', tab.url);

            try {
                const contentArray = await browser.tabs.executeScript(tabId, {
                    code: `
                        (() => {
                            const elements = document.querySelectorAll('body, main, article, h1, h2, h3, title');
                            let textContent = '';
                            elements.forEach(el => {
                                if (el && el.innerText) {
                                    textContent += el.innerText + ' ';
                                }
                            });
                            return textContent.substring(0, 1000);
                        })();
                    `
                });
                const pageContent = contentArray[0] || '';
                console.log('Page content extracted for:', tab.url);
                
                if (tab.url && tab.url !== "about:blank" && tab.url !== "moz-extension://a83e4955-07e0-4493-86d7-0581efc7c93d/blocked.html" && tab.url !== "undefined" && tab.url !== null) {
                    checkWithAI(tabId, tab.url, pageContent);
                }
            } catch (error) {
                console.error('Error extracting content for tab:', tabId, error);
            }
        }, 5000);

        // Store the timeout ID
        timeouts.set(tabId, timeoutId);
        console.log('Set timeout for tab:', tabId);
    } else if (changeInfo.status === 'loading') {
        // If the page starts loading again, clear the previous timeout
        if (timeouts.has(tabId)) {
            clearTimeout(timeouts.get(tabId));
            timeouts.delete(tabId);
            console.log('Cleared timeout for tab (navigation):', tabId);
        }
    }
});

// Clear timeout if the tab is removed
browser.tabs.onRemoved.addListener((tabId) => {
    if (timeouts.has(tabId)) {
        clearTimeout(timeouts.get(tabId));
        timeouts.delete(tabId);
        console.log('Cleared timeout for removed tab:', tabId);
    }
});
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
                "model": "nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.Q4_K_M.gguf",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a website productivity analyzer. If the website is related to studying in university eletrical engineering and information technology, do not block it; if it's unrelated to productivity (I am student bachelor in eletrical engineering and information technolgy study STEM subjects), block it. Analyze the content thoroughly. you should decide to block or not block the website. in the should_block field, enter true if you want to block the website, and false if you don't want to block it. Games, unrelated google searches and social media should be blocked. "
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
                "temperature": 50,
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
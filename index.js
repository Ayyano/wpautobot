// --- 5. SMART DISH DETECTION ---
            const currentMenu = await getMenuFromApp();
            const cleanText = text.replace("order ", "").trim();
            let matchedItem = null;

            // Only search if they typed at least 3 letters (prevents matching "ok" or "")
            if (cleanText.length > 2) {
                matchedItem = currentMenu.find(item => 
                    item.name.toLowerCase().includes(cleanText) || 
                    cleanText.includes(item.name.toLowerCase())
                );
            }

            if (matchedItem) {
                orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
                const captionText = `🛒 *Order Started!*\n\nYou selected: *${matchedItem.name}* (Rs. ${matchedItem.price})\n\nPlease reply with your *Full Name, Phone Number, and Delivery Address in Charsadda*.`;
                
                // 🌟 FIX: Safe Image Loading Try/Catch
                try {
                    if (matchedItem.imageUrl && matchedItem.imageUrl.length > 5) {
                        // Attempt to send with image
                        await sock.sendMessage(sender, { image: { url: matchedItem.imageUrl }, caption: captionText });
                    } else {
                        // No image URL provided, send text only
                        await sock.sendMessage(sender, { text: captionText });
                    }
                } catch (imgError) {
                    // If image download is blocked (Error 403), fallback to Text Only!
                    console.log(`⚠️ Image blocked for ${matchedItem.name}. Sending text only.`);
                    await sock.sendMessage(sender, { text: captionText });
                }
                
                return; // Stop processing further
            }

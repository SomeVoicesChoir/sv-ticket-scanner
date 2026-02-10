<div id="ticket-checkout-container">
    <div id="progress-indicator" style="display: none;">
        <div class="progress-steps">
            <div class="progress-step active" id="step-1">
                <div class="step-number">1</div>
                <div class="step-label">Select Tickets</div>
            </div>
            <div class="progress-line"></div>
            <div class="progress-step" id="step-2">
                <div class="step-number">2</div>
                <div class="step-label">Your Details</div>
            </div>
            <div class="progress-line"></div>
            <div class="progress-step" id="step-3">
                <div class="step-number">3</div>
                <div class="step-label">Payment</div>
            </div>
        </div>
    </div>

    <form id="ticket-form">
        <!-- SHOW SELECTOR -->
        <div class="form-group">
            <label for="show-select">Select Event *</label>
            <select id="show-select" required>
                <option value="">Loading events...</option>
            </select>
        </div>

        <!-- SHOW INFO (image + description side by side) -->
        <div id="show-info" style="display: none; flex-direction: column; align-items: center; gap: 12px; padding: 12px; background: #f5f5f5; border-radius: 8px; margin: -10px 0 20px 0;">
        <img id="show-image" src="" alt="" style="display: none; width: 260px; height: 260px; object-fit: cover; border-radius: 6px;">
        <div id="show-description" style="display: none; font-size: 16px; color: #333; line-height: 1.5; text-align: center;"></div>
        </div>

        <!-- DATE/TIME SELECTOR (dependent on show) -->
        <div class="form-group" id="event-select-group" style="display: none;">
            <label for="event-select">Select Date & Time *</label>
            <select id="event-select" required>
                <option value="">Select a date & time...</option>
            </select>
        </div>

        <div class="form-group" id="ticket-selection-group" style="display: none;">
            <label>Select your tickets</label>
            <div id="ticket-types-list" style="margin-top: 10px;"></div>
            <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 14px;">
                <span id="max-tickets-message"><strong>Maximum 4 tickets per purchase</strong></span>
                <span id="companion-note" style="display: none;"><br>(Companion tickets do not count towards this limit)</span>
            </div>
        </div>

        <div id="companion-ticket-section" style="display: none; margin: 20px 0; padding: 15px; background: #e3f2fd; border-radius: 8px; border: 2px solid #2196F3;">
            <div style="display: flex; align-items: flex-start;">
                <input type="checkbox" id="companion-ticket-checkbox" style="width: auto !important; padding: 0 !important; margin: 7px 10px 0 0 !important; transform: scale(1.5); cursor: pointer; flex-shrink: 0;">
                <label for="companion-ticket-checkbox" style="flex: 1; cursor: pointer; font-weight: 600; color: #1565c0; font-size: 15px;">
                    I need a free companion ticket (one per accessible ticket holder)
                </label>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">
                Access companions provide support to ticket holders who need assistance during the event.
            </p>
        </div>

        <div id="event-details" style="display: none; margin: 15px 0; padding: 5px 10px; background: #f5f5f5; border-radius: 5px;">
            <p id="event-datetime" style="margin: 3px 0;"></p>
            <p id="event-doors-performance" style="margin: 3px 0;"></p>
        </div>

        <div id="total-price" style="margin: 20px 0; font-size: 1.3em; font-weight: bold; display: none;"></div>

        <div id="sticky-total-bar" style="display: none;">
            <div id="sticky-total-content">
                <span id="sticky-total-text"></span>
                <button type="button" onclick="scrollToCheckout()" id="sticky-checkout-btn">Continue</button>
            </div>
        </div>

        <div id="booking-form-fields" style="display: none;">
        <div class="form-group">
            <label for="attendee-firstname">First Name *</label>
            <input type="text" id="attendee-firstname" required>
        </div>

        <div class="form-group">
            <label for="attendee-surname">Surname *</label>
            <input type="text" id="attendee-surname" required>
        </div>

        <div class="form-group">
            <label for="attendee-email">Your Email *</label>
            <input type="email" id="attendee-email" required>
        </div>

        <div class="form-group">
            <label for="attendee-email-confirm">Confirm Your Email *</label>
            <input type="email" id="attendee-email-confirm" required>
            <small id="email-match-message" style="display: none;"></small>
        </div>

        <div class="form-group">
            <label for="attendee-phone">Mobile Phone Number *</label>
            <input type="tel" id="attendee-phone" required placeholder="+44 7XXX XXXXXX">
        </div>

        <div class="form-group">
            <label for="attendee-postcode">Post Code *</label>
            <input type="text" id="attendee-postcode" required placeholder="SW1A 1AA">
        </div>

        <div style="margin: 30px 0 20px 0; text-align: left;">
    <div style="display: flex; align-items: flex-start; max-width: 100%;">
        <input type="checkbox" id="agreeCheckbox" required style="width: auto !important; padding: 0 !important; margin: 7px 10px 0 0 !important; transform: scale(1.5); cursor: pointer; flex-shrink: 0;">
        <span style="flex: 1; cursor: pointer; text-align: left; word-wrap: break-word; overflow-wrap: break-word;">I agree to the <a href="https://somevoices.co.uk/eventtandcs" target="_blank" style="color: #ea3e28; text-decoration: underline;">Terms & Conditions</a> *</span>
    </div>
</div>
        <div style="margin: 20px 0 20px 0; text-align: left;">
    <div style="display: flex; align-items: flex-start; max-width: 100%;">
        <input type="checkbox" id="optInCheckbox" style="width: auto !important; padding: 0 !important; margin: 7px 10px 0 0 !important; transform: scale(1.5); cursor: pointer; flex-shrink: 0;">
        <span style="flex: 1; cursor: pointer; text-align: left; word-wrap: break-word; overflow-wrap: break-word;">Some Voices may contact you about future events and activities. We will never share your information with third parties. Tick here if you want to receive these communications.</span>
    </div>
</div>

        <button type="submit" id="checkout-button">Proceed to Payment</button>
        <div id="error-message" style="color: red; margin-top: 10px;"></div>
        </div>
    </form>
</div>

<style>
#ticket-checkout-container {
    max-width: 500px;
    margin: 0 auto;
    padding: 20px;
    padding-bottom: 100px;
}
.form-group {
    margin-bottom: 20px;
}
.form-group label {
    display: block;
    margin-bottom: 5px;
}
.form-group input, .form-group select {
    width: 100%;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 16px;
}
.form-group small {
    display: block;
    margin-top: 5px;
    color: #666;
    font-size: 0.9em;
}
#checkout-button {
    width: 100%;
    padding: 15px;
    background: #ea3e28;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 24px;
    font-weight: normal;
    cursor: pointer;
}
#checkout-button:hover {
    background: #d63520;
}
#checkout-button:disabled {
    background: #ccc;
    cursor: not-allowed;
}
.ticket-type-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    margin-bottom: 8px;
    background: white;
    border: 2px solid #ddd;
    border-radius: 8px;
    transition: border-color 0.3s;
}
.ticket-type-row:hover {
    border-color: #ea3e28;
}
.ticket-type-info {
    flex: 1;
}
.ticket-type-name {
    font-weight: 600;
    font-size: 16px;
    color: #333;
}
.ticket-remaining {
    font-size: 13px;
    color: #666;
    margin-top: 2px;
}
.ticket-sold-out {
    opacity: 0.5;
    pointer-events: none;
}
.ticket-sold-out .ticket-type-name::after {
    content: " - SOLD OUT";
    color: #e74c3c;
    font-weight: bold;
}
.quantity-controls {
    display: flex;
    align-items: center;
    gap: 8px;
}
.qty-btn {
    width: 32px;
    height: 32px;
    border: 2px solid #ea3e28;
    background: white;
    color: #ea3e28;
    border-radius: 6px;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}
.qty-btn:hover:not(:disabled) {
    background: #ea3e28;
    color: white;
}
.qty-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}
.qty-display {
    width: 40px;
    text-align: center;
    font-size: 18px;
    font-weight: bold;
}
#progress-indicator {
    background: white;
    padding: 20px;
    margin-bottom: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.progress-steps {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 400px;
    margin: 0 auto;
}
.progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    opacity: 0.4;
    transition: opacity 0.3s;
}
.progress-step.active {
    opacity: 1;
}
.progress-step.completed {
    opacity: 1;
}
.step-number {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #ddd;
    color: #666;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    transition: all 0.3s;
}
.progress-step.active .step-number {
    background: #ea3e28;
    color: white;
}
.progress-step.completed .step-number {
    background: #28a745;
    color: white;
}
.step-label {
    font-size: 12px;
    font-weight: 600;
    color: #666;
    white-space: nowrap;
}
.progress-line {
    flex: 1;
    height: 2px;
    background: #ddd;
    margin: 0 10px;
    max-width: 60px;
}
#sticky-total-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: white;
    box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
    padding: 15px 20px;
    display: none;
    z-index: 9999;
    pointer-events: auto;
    animation: slideUp 0.3s ease;
}
@keyframes slideUp {
    from {
        transform: translateY(100%);
    }
    to {
        transform: translateY(0);
    }
}
#sticky-total-content {
    max-width: 500px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
#sticky-total-text {
    font-size: 18px;
    font-weight: bold;
    color: #333;
}
#sticky-checkout-btn {
    background: #ea3e28;
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
}
#sticky-checkout-btn:hover {
    background: #d63520;
}
</style>

<script src="https://js.stripe.com/v3/"></script>
<script>
const API_BASE = 'https://sv-ticket-scanner.vercel.app/api';
const STRIPE_PUBLIC_KEY = 'pk_live_e3BY9meg9xi16XR7UQ211bv6';
const stripe = Stripe(STRIPE_PUBLIC_KEY);
let eventsData = [];
let selectedShowName = '';
let selectedEventName = '';
let ticketQuantities = {};
let needsCompanionTicket = false;
let hasAccessibleTicket = false;

async function loadEvents() {
    try {
        const response = await fetch(API_BASE + '/get-events');
        const data = await response.json();
        eventsData = data.events;
        // No event type filter on member page — all events are shown
        
        // Get unique show names
        const showNames = [...new Set(eventsData.map(function(event) { return event.showName; }))].filter(Boolean);
        
        const showSelect = document.getElementById('show-select');
        showSelect.innerHTML = '<option value="">Select an event...</option>';
        showNames.forEach(function(showName) {
            const option = document.createElement('option');
            option.value = showName;
            option.textContent = showName;
            showSelect.appendChild(option);
        });

        // Check for pre-selected event in URL
        const urlParams = new URLSearchParams(window.location.search);
        const preselectedEvent = urlParams.get('event');
        if (preselectedEvent) {
            const showSelect = document.getElementById('show-select');
            showSelect.value = preselectedEvent;
            showSelect.dispatchEvent(new Event('change'));
        }
    } catch (error) {
        console.error('Error loading events:', error);
        document.getElementById('error-message').textContent = 'Failed to load events. Please refresh the page.';
    }
}

// SHOW SELECTOR — populates date/time dropdown
document.getElementById('show-select').addEventListener('change', function() {
    selectedShowName = this.value;
    const eventSelectGroup = document.getElementById('event-select-group');
    const eventSelect = document.getElementById('event-select');
    
    // Reset everything downstream
    resetFromDateLevel();
    
    if (selectedShowName) {
        // Get unique event names (date/times) for this show
        const showEvents = eventsData.filter(function(event) { return event.showName === selectedShowName; });
        const uniqueEventNames = [...new Set(showEvents.map(function(event) { return event.name; }))];
        
        eventSelect.innerHTML = '<option value="">Select a date & time...</option>';
        uniqueEventNames.forEach(function(eventName) {
            const option = document.createElement('option');
            option.value = eventName;
            option.textContent = eventName;
            eventSelect.appendChild(option);
        });
        
        // If there's only one date/time, auto-select it
        if (uniqueEventNames.length === 1) {
            eventSelect.value = uniqueEventNames[0];
            eventSelect.dispatchEvent(new Event('change'));
        }
        
        // Show info (image + description)
        const showInfoDiv = document.getElementById('show-info');
        const showImage = document.getElementById('show-image');
        const showDescDiv = document.getElementById('show-description');
        const showEvent = showEvents[0];

        if (showEvent && (showEvent.showDescription || showEvent.showImage)) {
            showInfoDiv.style.display = 'flex';

            if (showEvent.showImage) {
                showImage.src = showEvent.showImage;
                showImage.alt = selectedShowName;
                showImage.style.display = 'block';
            } else {
                showImage.style.display = 'none';
            }

            if (showEvent.showDescription) {
                showDescDiv.innerHTML = showEvent.showDescription.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #ea3e28; text-decoration: underline;">$1</a>');
                showDescDiv.style.display = 'block';
            } else {
                showDescDiv.style.display = 'none';
            }
        } else {
            showInfoDiv.style.display = 'none';
        }
        
        eventSelectGroup.style.display = 'block';
    } else {
        eventSelectGroup.style.display = 'none';
    }
});

function resetFromDateLevel() {
    selectedEventName = '';
    ticketQuantities = {};
    needsCompanionTicket = false;
    hasAccessibleTicket = false;
    
    document.getElementById('event-select').innerHTML = '<option value="">Select a date & time...</option>';
    document.getElementById('ticket-selection-group').style.display = 'none';
    document.getElementById('ticket-types-list').innerHTML = '';
    document.getElementById('event-details').style.display = 'none';
    document.getElementById('booking-form-fields').style.display = 'none';
    document.getElementById('total-price').style.display = 'none';
    document.getElementById('total-price').textContent = '';
    document.getElementById('sticky-total-bar').style.display = 'none';
    document.getElementById('progress-indicator').style.display = 'none';
    document.getElementById('companion-ticket-section').style.display = 'none';
    document.getElementById('companion-ticket-checkbox').checked = false;
    document.getElementById('show-info').style.display = 'none';
    
    document.getElementById('step-1').classList.remove('completed');
    document.getElementById('step-2').classList.remove('active', 'completed');
    document.getElementById('step-3').classList.remove('active');
}

// DATE/TIME SELECTOR — populates ticket types
document.getElementById('event-select').addEventListener('change', function() {
    selectedEventName = this.value;
    const ticketSelectionGroup = document.getElementById('ticket-selection-group');
    const ticketTypesList = document.getElementById('ticket-types-list');
    const detailsDiv = document.getElementById('event-details');
    const bookingFormFields = document.getElementById('booking-form-fields');
    const totalPriceDiv = document.getElementById('total-price');
    
    ticketQuantities = {};
    detailsDiv.style.display = 'none';
    bookingFormFields.style.display = 'none';
    totalPriceDiv.style.display = 'none';
    totalPriceDiv.textContent = '';
    document.getElementById('sticky-total-bar').style.display = 'none';
    
    if (selectedEventName) {
        const ticketOptions = eventsData.filter(function(event) { return event.name === selectedEventName; });
        ticketTypesList.innerHTML = '';
        
        if (ticketOptions.length > 0) {
            const firstEvent = ticketOptions[0];
            document.getElementById('event-datetime').textContent = firstEvent.dateTime;
            document.getElementById('event-doors-performance').textContent = firstEvent.doorsPerformance || '';
            detailsDiv.style.display = 'block';
            document.getElementById('progress-indicator').style.display = 'block';
            // Update max tickets message based on event setting
            var maxTickets = firstEvent.maxTickets || 4;
            document.getElementById('max-tickets-message').innerHTML = '<strong>Maximum ' + maxTickets + ' ticket' + (maxTickets > 1 ? 's' : '') + ' per purchase</strong>';
        }
        
        ticketOptions.forEach(function(event) {
            // FILTER OUT COMPANION TICKETS - don't show to customers
            const ticketTypeLower = (event.ticketType || '').toLowerCase();
            const ticketTypePriceLower = (event.ticketTypePrice || '').toLowerCase();
            if (ticketTypeLower.includes('companion') || ticketTypePriceLower.includes('companion')) {
                return;
            }
            
            const row = document.createElement('div');
            row.className = 'ticket-type-row';
            if (event.ticketsRemaining === 0) {
                row.classList.add('ticket-sold-out');
            }
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'ticket-type-info';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'ticket-type-name';
            nameDiv.textContent = event.ticketTypePrice;
            
            const remainingDiv = document.createElement('div');
            remainingDiv.className = 'ticket-remaining';
            if (event.ticketsRemaining === 0) {
                remainingDiv.textContent = 'Sold out';
            } else if (event.ticketsRemaining < 40) {
                remainingDiv.textContent = 'Last ' + event.ticketsRemaining + ' ticket' + (event.ticketsRemaining > 1 ? 's' : '') + ' remaining';
            }
            
            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(remainingDiv);
            
            const controlDiv = document.createElement('div');
            controlDiv.className = 'quantity-controls';
            
            const minusBtn = document.createElement('button');
            minusBtn.type = 'button';
            minusBtn.className = 'qty-btn';
            minusBtn.textContent = '−';
            minusBtn.disabled = true;
            minusBtn.dataset.eventId = event.id;
            minusBtn.dataset.action = 'decrease';
            minusBtn.onclick = function() { decreaseQuantity(event.id); };
            
            const qtyDisplay = document.createElement('div');
            qtyDisplay.className = 'qty-display';
            qtyDisplay.id = 'qty-' + event.id;
            qtyDisplay.textContent = '0';
            
            const plusBtn = document.createElement('button');
            plusBtn.type = 'button';
            plusBtn.className = 'qty-btn';
            plusBtn.textContent = '+';
            plusBtn.dataset.eventId = event.id;
            plusBtn.dataset.action = 'increase';
            plusBtn.onclick = function() { increaseQuantity(event.id); };
            if (event.ticketsRemaining === 0) {
                plusBtn.disabled = true;
            }
            
            controlDiv.appendChild(minusBtn);
            controlDiv.appendChild(qtyDisplay);
            controlDiv.appendChild(plusBtn);
            
            row.appendChild(infoDiv);
            row.appendChild(controlDiv);
            ticketTypesList.appendChild(row);
            
            ticketQuantities[event.id] = 0;
        });
        
        ticketSelectionGroup.style.display = 'block';
    } else {
        ticketSelectionGroup.style.display = 'none';
        ticketTypesList.innerHTML = '';
    }
});

function checkForAccessibleTickets() {
    hasAccessibleTicket = false;
    
    for (let eventId in ticketQuantities) {
        if (ticketQuantities[eventId] > 0) {
            const event = eventsData.find(function(e) { return e.id === eventId; });
            if (event) {
                const ticketType = (event.ticketType || '').toLowerCase();
                const ticketTypePrice = (event.ticketTypePrice || '').toLowerCase();
                if (ticketType.includes('accessible') || ticketType.includes('wheelchair') ||
                    ticketTypePrice.includes('accessible') || ticketTypePrice.includes('wheelchair')) {
                    hasAccessibleTicket = true;
                    break;
                }
            }
        }
    }
    
    const companionSection = document.getElementById('companion-ticket-section');
    const companionNote = document.getElementById('companion-note');
    
    if (hasAccessibleTicket) {
        companionSection.style.display = 'block';
        if (companionNote) companionNote.style.display = 'inline';
    } else {
        companionSection.style.display = 'none';
        if (companionNote) companionNote.style.display = 'none';
        document.getElementById('companion-ticket-checkbox').checked = false;
        needsCompanionTicket = false;
    }
}

// Helper function to get max tickets for the currently selected event
function getMaxTickets() {
    var currentEvent = eventsData.find(function(e) { return e.name === selectedEventName; });
    return (currentEvent && currentEvent.maxTickets) ? currentEvent.maxTickets : 4;
}

function increaseQuantity(eventId) {
    let totalTickets = Object.values(ticketQuantities).reduce(function(sum, qty) { return sum + qty; }, 0);
    var maxTickets = getMaxTickets();
    if (totalTickets >= maxTickets) {
        alert('Maximum ' + maxTickets + ' ticket' + (maxTickets > 1 ? 's' : '') + ' per purchase');
        return;
    }
    const event = eventsData.find(function(e) { return e.id === eventId; });
    if (!event || ticketQuantities[eventId] >= event.ticketsRemaining) {
        return;
    }
    ticketQuantities[eventId]++;
    document.getElementById('qty-' + eventId).textContent = ticketQuantities[eventId];
    updateButtons(eventId);
    updateTotalPrice();
    updateProgressAndForm();
    checkForAccessibleTickets();
}

function decreaseQuantity(eventId) {
    if (ticketQuantities[eventId] > 0) {
        ticketQuantities[eventId]--;
        document.getElementById('qty-' + eventId).textContent = ticketQuantities[eventId];
        updateButtons(eventId);
        updateTotalPrice();
        updateProgressAndForm();
        checkForAccessibleTickets();
    }
}

function updateButtons(eventId) {
    const minusBtn = document.querySelector('.qty-btn[data-event-id="' + eventId + '"][data-action="decrease"]');
    const plusBtn = document.querySelector('.qty-btn[data-event-id="' + eventId + '"][data-action="increase"]');
    if (minusBtn) {
        minusBtn.disabled = ticketQuantities[eventId] === 0;
    }
    if (plusBtn) {
        const event = eventsData.find(function(e) { return e.id === eventId; });
        let totalTickets = Object.values(ticketQuantities).reduce(function(sum, qty) { return sum + qty; }, 0);
        var maxTickets = getMaxTickets();
        plusBtn.disabled = totalTickets >= maxTickets || ticketQuantities[eventId] >= event.ticketsRemaining;
    }
}

function updateProgressAndForm() {
    let totalTickets = Object.values(ticketQuantities).reduce(function(sum, qty) { return sum + qty; }, 0);
    const bookingFormFields = document.getElementById('booking-form-fields');
    const stickyBar = document.getElementById('sticky-total-bar');
    
    if (totalTickets > 0) {
        bookingFormFields.style.display = 'block';
        stickyBar.style.display = 'block';
        document.getElementById('step-1').classList.add('completed');
        document.getElementById('step-2').classList.add('active');
    } else {
        bookingFormFields.style.display = 'none';
        stickyBar.style.display = 'none';
        document.getElementById('step-1').classList.remove('completed');
        document.getElementById('step-2').classList.remove('active');
    }
}

function scrollToCheckout() {
    document.getElementById('booking-form-fields').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getCurrencySymbol(currency) {
    const symbols = { 'GBP': '£', 'EUR': '€', 'USD': '$' };
    return symbols[currency] || '£';
}

function checkEmailsMatch() {
    const email = document.getElementById('attendee-email').value;
    const emailConfirm = document.getElementById('attendee-email-confirm').value;
    const message = document.getElementById('email-match-message');
    const button = document.getElementById('checkout-button');
    if (emailConfirm === '') {
        message.style.display = 'none';
        return;
    }
    message.style.display = 'block';
    if (email === emailConfirm) {
        message.textContent = '✓ Emails match';
        message.style.color = 'green';
        const agreeCheckbox = document.getElementById('agreeCheckbox');
        if (agreeCheckbox.checked) {
            button.disabled = false;
        }
    } else {
        message.textContent = '✗ Emails do not match';
        message.style.color = 'red';
        button.disabled = true;
    }
}

document.getElementById('attendee-email').addEventListener('input', checkEmailsMatch);
document.getElementById('attendee-email-confirm').addEventListener('input', checkEmailsMatch);

document.getElementById('companion-ticket-checkbox').addEventListener('change', function() {
    needsCompanionTicket = this.checked;
    updateTotalPrice();
});

function updateTotalPrice() {
    let totalPrice = 0;
    let totalTickets = 0;
    let currency = 'GBP';
    
    for (let eventId in ticketQuantities) {
        const quantity = ticketQuantities[eventId];
        if (quantity > 0) {
            const event = eventsData.find(function(e) { return e.id === eventId; });
            if (event) {
                totalPrice += quantity * event.price;
                totalTickets += quantity;
                currency = event.currency || 'GBP';
            }
        }
    }
    
    const totalPriceDiv = document.getElementById('total-price');
    const stickyTotalText = document.getElementById('sticky-total-text');
    
    if (totalTickets > 0) {
        const currencySymbol = getCurrencySymbol(currency);
        let priceText = 'Total: ' + currencySymbol + totalPrice.toFixed(2) + ' for ' + totalTickets + ' ticket' + (totalTickets > 1 ? 's' : '');
        
        if (needsCompanionTicket && hasAccessibleTicket) {
            priceText += ' + 1 free companion ticket';
        }
        
        totalPriceDiv.textContent = priceText;
        totalPriceDiv.style.display = 'block';
        stickyTotalText.textContent = priceText;
    } else {
        totalPriceDiv.style.display = 'none';
    }
}

document.getElementById('ticket-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    document.getElementById('step-2').classList.add('completed');
    document.getElementById('step-3').classList.add('active');
    
    const button = document.getElementById('checkout-button');
    const errorDiv = document.getElementById('error-message');
    const email = document.getElementById('attendee-email').value;
    const emailConfirm = document.getElementById('attendee-email-confirm').value;
    
    if (email !== emailConfirm) {
        errorDiv.textContent = 'Emails do not match. Please check and try again.';
        return;
    }
    
    const selectedTickets = [];
    for (let eventId in ticketQuantities) {
        const quantity = ticketQuantities[eventId];
        if (quantity > 0) {
            const event = eventsData.find(function(e) { return e.id === eventId; });
            if (event) {
                selectedTickets.push({
                    eventId: event.id,
                    eventName: event.name,
                    stripePriceId: event.stripePriceId,
                    quantity: quantity,
                    ticketType: event.ticketType,
                    ticketTypePrice: event.ticketTypePrice,
                    price: event.price,
                    dateTime: event.dateTime,
                    venueAddress: event.venueAddress,
                    currency: event.currency || 'GBP'
                });
            }
        }
    }
    
    if (selectedTickets.length === 0) {
        errorDiv.textContent = 'Please select at least one ticket.';
        return;
    }
    
    button.disabled = true;
    button.textContent = 'Processing...';
    errorDiv.textContent = '';
    
    const firstName = document.getElementById('attendee-firstname').value;
    const surname = document.getElementById('attendee-surname').value;
    const phone = document.getElementById('attendee-phone').value;
    const postcode = document.getElementById('attendee-postcode').value;
    
    const formData = {
        selectedTickets: selectedTickets,
        firstName: firstName,
        surname: surname,
        attendeeEmail: email,
        phone: phone,
        postcode: postcode,
        mailingListOptIn: document.getElementById('optInCheckbox').checked,
        companionTicket: needsCompanionTicket && hasAccessibleTicket
    };
    
    if (needsCompanionTicket && hasAccessibleTicket && selectedTickets.length > 0) {
        const companionTicketEvent = eventsData.find(function(e) {
            const ticketTypeLower = (e.ticketType || '').toLowerCase();
            const ticketTypePriceLower = (e.ticketTypePrice || '').toLowerCase();
            return e.name === selectedEventName && 
                   (ticketTypeLower.includes('companion') || ticketTypePriceLower.includes('companion'));
        });
        
        if (companionTicketEvent) {
            formData.companionTicketDetails = {
                eventId: companionTicketEvent.id,
                eventName: companionTicketEvent.name,
                stripePriceId: companionTicketEvent.stripePriceId,
                ticketType: companionTicketEvent.ticketType,
                ticketTypePrice: companionTicketEvent.ticketTypePrice,
                dateTime: companionTicketEvent.dateTime,
                venueAddress: companionTicketEvent.venueAddress,
                currency: companionTicketEvent.currency || 'GBP'
            };
        }
    }
    
    console.log('Form data being sent:', formData);
    console.log('Selected tickets:', selectedTickets);
    
    try {
        const response = await fetch(API_BASE + '/create-ticket-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const result = await stripe.redirectToCheckout({ sessionId: data.sessionId });
            if (result.error) {
                throw new Error(result.error.message);
            }
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = error.message;
        button.disabled = false;
        button.textContent = 'Proceed to Payment';
    }
});

const agreeCheckbox = document.getElementById('agreeCheckbox');
const checkoutButton = document.getElementById('checkout-button');
checkoutButton.disabled = true;

agreeCheckbox.addEventListener('change', function() {
    const email = document.getElementById('attendee-email').value;
    const emailConfirm = document.getElementById('attendee-email-confirm').value;
    if (this.checked && email === emailConfirm && email !== '') {
        checkoutButton.disabled = false;
    } else {
        checkoutButton.disabled = true;
    }
});

loadEvents();
</script>
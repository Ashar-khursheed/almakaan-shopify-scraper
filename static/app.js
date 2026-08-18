// State Management
let currentPage = 1;
let currentLimit = 25;
let currentProductsData = [];
let totalProductsCount = 0;
let isScraperRunning = false;
let eventSource = null;
let searchDebounceTimer = null;

// DOM Elements
const targetUrlInput = document.getElementById('targetUrlInput');
const resetUrlBtn = document.getElementById('resetUrlBtn');
const startScrapeBtn = document.getElementById('startScrapeBtn');
const stopScrapeBtn = document.getElementById('stopScrapeBtn');

const globalStatusPill = document.getElementById('globalStatusPill');
const globalStatusText = document.getElementById('globalStatusText');
const progressPctText = document.getElementById('progressPctText');
const progressBarFill = document.getElementById('progressBarFill');
const currentActionText = document.getElementById('currentActionText');
const spinnerIcon = document.getElementById('spinnerIcon');
const progressCounterText = document.getElementById('progressCounterText');
const terminalLogs = document.getElementById('terminalLogs');

const statTotalScraped = document.getElementById('statTotalScraped');
const statInStock = document.getElementById('statInStock');
const statOutOfStock = document.getElementById('statOutOfStock');
const statAvgPrice = document.getElementById('statAvgPrice');
const statVendors = document.getElementById('statVendors');

const tableBody = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const vendorFilter = document.getElementById('vendorFilter');
const stockFilter = document.getElementById('stockFilter');
const sortBySelect = document.getElementById('sortBySelect');
const refreshTableBtn = document.getElementById('refreshTableBtn');
const tableTotalCount = document.getElementById('tableTotalCount');

const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageIndicator = document.getElementById('pageIndicator');
const pageRangeText = document.getElementById('pageRangeText');
const pageTotalText = document.getElementById('pageTotalText');

const productModal = document.getElementById('productModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalProductTitle = document.getElementById('modalProductTitle');
const modalBody = document.getElementById('modalBody');

// Toast Notification Helper
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-info text-indigo';
    if (type === 'success') icon = 'fa-circle-check text-emerald';
    if (type === 'warning') icon = 'fa-triangle-exclamation text-amber';
    if (type === 'error') icon = 'fa-circle-exclamation text-rose';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Format Currency
function formatCurrency(val) {
    return parseFloat(val || 0).toFixed(2);
}

// Reset URL
resetUrlBtn.addEventListener('click', () => {
    targetUrlInput.value = 'https://almakaanstore.com/collections/kitchen-tools';
    showToast('Reset URL to default Kitchen Tools collection', 'info');
});

// Initialize EventSource SSE Stream
function initSSE() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource('/api/stream-progress');

    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            updateDashboardProgress(data);
        } catch (err) {
            console.error('SSE Error:', err);
        }
    };

    eventSource.onerror = function() {
        console.warn('SSE connection interrupted, retrying...');
    };
}

// Update UI based on SSE progress data
function updateDashboardProgress(state) {
    isScraperRunning = state.is_running;
    const status = state.status.toLowerCase();

    // Update Status Pill
    globalStatusPill.className = `status-pill ${status}`;
    globalStatusText.textContent = state.status.toUpperCase();

    // Progress Bar
    const pct = state.progress_percentage || 0;
    progressBarFill.style.width = `${pct}%`;
    progressPctText.textContent = `${pct}%`;

    // Action text & counter
    currentActionText.innerHTML = `${state.is_running ? '<i class="fa-solid fa-circle-notch fa-spin text-muted"></i> ' : ''}${state.current_action || 'Idle'}`;
    progressCounterText.textContent = `${state.scraped_count} / ${state.total_products} Products`;

    // Buttons toggle
    startScrapeBtn.disabled = state.is_running;
    stopScrapeBtn.disabled = !state.is_running;

    // Terminal Logs
    if (state.logs && state.logs.length > 0) {
        renderTerminalLogs(state.logs);
    }

    // Auto-refresh table when products count changes or completes
    if (state.scraped_count !== totalProductsCount || status === 'completed') {
        totalProductsCount = state.scraped_count;
        fetchProductsData();
    }
}

// Render Terminal Logs
function renderTerminalLogs(logs) {
    terminalLogs.innerHTML = '';
    logs.forEach(log => {
        const line = document.createElement('div');
        line.className = `log-line ${log.level}`;
        line.innerHTML = `<span class="log-time">[${log.time}]</span> <span>${escapeHtml(log.message)}</span>`;
        terminalLogs.appendChild(line);
    });
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Start Scraper Action
startScrapeBtn.addEventListener('click', async () => {
    const url = targetUrlInput.value.trim();
    if (!url) {
        showToast('Please enter a valid Shopify collection URL', 'warning');
        return;
    }

    try {
        startScrapeBtn.disabled = true;
        // Reset progress UI immediately for fresh scrape run
        progressBarFill.style.width = '0%';
        progressPctText.textContent = '0%';
        currentActionText.textContent = 'Starting fresh extraction task...';
        progressCounterText.textContent = '0 / 0 Products';
        terminalLogs.innerHTML = '';
        totalProductsCount = 0;

        const res = await fetch('/api/start-scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        const data = await res.json();
        
        if (data.status === 'success') {
            showToast('Scraper started successfully!', 'success');
        } else {
            showToast(data.message, 'error');
            startScrapeBtn.disabled = false;
        }
    } catch (err) {
        showToast('Failed to start scraper server call.', 'error');
        startScrapeBtn.disabled = false;
    }
});

// Stop Scraper Action
stopScrapeBtn.addEventListener('click', async () => {
    try {
        stopScrapeBtn.disabled = true;
        const res = await fetch('/api/stop-scrape', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, 'warning');
    } catch (err) {
        showToast('Failed to stop scraper.', 'error');
    }
});

// Fetch Scraped Products Data
async function fetchProductsData() {
    const search = searchInput.value.trim();
    const vendor = vendorFilter.value;
    const stock = stockFilter.value;
    const sort = sortBySelect.value;

    const params = new URLSearchParams({
        search: search,
        vendor: vendor,
        stock_status: stock,
        sort_by: sort,
        page: currentPage,
        limit: currentLimit
    });

    try {
        const res = await fetch(`/api/products?${params.toString()}`);
        const data = await res.json();

        currentProductsData = data.products;
        totalProductsCount = data.total_unfiltered;

        renderMetrics(data);
        renderVendorDropdown(data.vendors);
        renderTable(data);
        renderPagination(data);
    } catch (err) {
        console.error('Failed to load products data:', err);
    }
}

// Render Top Stats Cards
async function renderMetrics(data) {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();

        statTotalScraped.textContent = stats.total || 0;
        statInStock.textContent = stats.in_stock || 0;
        statOutOfStock.textContent = stats.out_of_stock || 0;
        statAvgPrice.textContent = (stats.avg_price || 0).toFixed(2);
        statVendors.textContent = stats.vendors_count || 0;
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

// Render Vendor Filter Options
function renderVendorDropdown(vendors) {
    if (!vendors) return;
    const currentSelected = vendorFilter.value;
    
    // keep first default option
    vendorFilter.innerHTML = '<option value="">All Vendors / Brands</option>';
    vendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        if (v === currentSelected) opt.selected = true;
        vendorFilter.appendChild(opt);
    });
}

// Render Data Table Rows
function renderTable(data) {
    tableTotalCount.textContent = data.total;

    if (!data.products || data.products.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-content">
                        <i class="fa-solid fa-folder-open empty-icon"></i>
                        <p>No products found matching your current filters.</p>
                        <span class="sub-text">Try resetting search or vendor dropdown filters.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    data.products.forEach((p, idx) => {
        const imgSrc = p.main_image || 'https://via.placeholder.com/60?text=No+Img';
        const isStock = p.in_stock;
        const stockBadge = isStock 
            ? `<span class="stock-badge in-stock"><i class="fa-solid fa-check"></i> In Stock</span>`
            : `<span class="stock-badge out-of-stock"><i class="fa-solid fa-xmark"></i> Out of Stock</span>`;

        const compareHtml = p.compare_at_price_max > p.price_min 
            ? `<span class="price-compare">${p.compare_at_price_max.toFixed(2)}</span><span class="discount-badge">-${p.discount_percentage}%</span>`
            : '';

        const tagsHtml = (p.tags || []).slice(0, 3).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('');

        html += `
            <tr>
                <td>
                    <img src="${imgSrc}" alt="${escapeHtml(p.title)}" class="thumb-img" onerror="this.src='https://via.placeholder.com/60?text=No+Img'">
                </td>
                <td>
                    <div class="product-cell">
                        <a href="${p.url}" target="_blank" class="product-title-link" title="Open product in store">${escapeHtml(p.title)}</a>
                        <div>${tagsHtml}</div>
                    </div>
                </td>
                <td><span class="font-medium">${escapeHtml(p.vendor || 'N/A')}</span></td>
                <td>
                    <div class="font-mono text-muted text-xs">${escapeHtml(p.primary_sku || 'No SKU')}</div>
                    ${p.barcodes ? `<div class="font-mono text-muted text-xs">BC: ${escapeHtml(p.barcodes.split(',')[0])}</div>` : ''}
                </td>
                <td>
                    <div class="price-main">${p.price_display}</div>
                    ${compareHtml}
                </td>
                <td>${stockBadge}</td>
                <td>
                    <span class="font-mono">${p.variant_count} Var.</span> / 
                    <span class="font-mono text-muted">${p.images_count} Imgs</span>
                </td>
                <td style="text-align: center;">
                    <button class="btn btn-sm btn-outline view-detail-btn" data-index="${idx}">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;

    // Attach click listeners to view detail buttons
    document.querySelectorAll('.view-detail-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(btn.getAttribute('data-index'));
            openProductModal(data.products[index]);
        });
    });
}

// Render Pagination Controls
function renderPagination(data) {
    const total = data.total;
    const page = data.page;
    const limit = data.limit;
    const totalPages = data.total_pages;

    const start = total === 0 ? 0 : (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);

    pageRangeText.textContent = `${start} - ${end}`;
    pageTotalText.textContent = total;
    pageIndicator.textContent = `Page ${page} of ${totalPages}`;

    prevPageBtn.disabled = (page <= 1);
    nextPageBtn.disabled = (page >= totalPages);
}

// Pagination Events
prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        fetchProductsData();
    }
});

nextPageBtn.addEventListener('click', () => {
    currentPage++;
    fetchProductsData();
});

// Search & Filters Listeners
searchInput.addEventListener('input', (e) => {
    if (e.target.value.trim().length > 0) {
        clearSearchBtn.classList.remove('hidden');
    } else {
        clearSearchBtn.classList.add('hidden');
    }

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        currentPage = 1;
        fetchProductsData();
    }, 300);
});

clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    currentPage = 1;
    fetchProductsData();
});

vendorFilter.addEventListener('change', () => {
    currentPage = 1;
    fetchProductsData();
});

stockFilter.addEventListener('change', () => {
    currentPage = 1;
    fetchProductsData();
});

sortBySelect.addEventListener('change', () => {
    currentPage = 1;
    fetchProductsData();
});

refreshTableBtn.addEventListener('click', () => {
    fetchProductsData();
    showToast('Catalog view refreshed.', 'info');
});

// Open Modal with Detailed Specs
function openProductModal(product) {
    modalProductTitle.textContent = product.title;

    const allImages = product.all_images && product.all_images.length > 0 
        ? product.all_images 
        : ['https://via.placeholder.com/300?text=No+Image'];

    let thumbsHtml = allImages.map((img, i) => `
        <img src="${img}" class="modal-thumb-mini ${i === 0 ? 'active' : ''}" onclick="changeModalImage('${img}', this)">
    `).join('');

    let variantsRows = (product.variants || []).map(v => `
        <tr>
            <td class="font-mono">${escapeHtml(v.title)}</td>
            <td class="font-mono text-muted">${escapeHtml(v.sku || 'N/A')}</td>
            <td class="font-mono text-emerald">${v.price.toFixed(2)} AED</td>
            <td>${v.available ? '<span class="text-emerald font-semibold">Available</span>' : '<span class="text-rose">Out of Stock</span>'}</td>
            <td class="font-mono text-muted">${escapeHtml(v.barcode || 'N/A')}</td>
        </tr>
    `).join('');

    modalBody.innerHTML = `
        <div class="modal-grid">
            <div class="modal-gallery">
                <img id="modalMainImg" src="${allImages[0]}" class="modal-main-img" alt="${escapeHtml(product.title)}">
                <div class="modal-thumbs">${thumbsHtml}</div>
            </div>
            <div class="modal-details">
                <div>
                    <span class="stock-badge ${product.in_stock ? 'in-stock' : 'out-of-stock'}">${product.stock_status}</span>
                    <a href="${product.url}" target="_blank" class="btn btn-sm btn-outline ml-1"><i class="fa-solid fa-arrow-up-right-from-square"></i> View on Store</a>
                </div>

                <div class="metrics-grid" style="grid-template-columns: 1fr 1fr; margin-top: 10px;">
                    <div class="metric-card">
                        <div class="metric-info">
                            <span class="metric-label">Vendor / Brand</span>
                            <span class="font-semibold text-white">${escapeHtml(product.vendor || 'N/A')}</span>
                        </div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-info">
                            <span class="metric-label">Price Range</span>
                            <span class="font-semibold text-emerald">${product.price_display}</span>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 10px;">
                    <h4 class="font-semibold text-white mb-1" style="font-size: 13px;">Tags & Categories:</h4>
                    <div>${(product.tags || []).map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>
                </div>
            </div>
        </div>

        <div style="margin-top: 20px;">
            <h3 class="font-semibold text-white mb-2" style="font-size: 14px;"><i class="fa-solid fa-list-check text-indigo"></i> Product Variants (${product.variant_count})</h3>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Variant Title</th>
                            <th>SKU</th>
                            <th>Price</th>
                            <th>Stock</th>
                            <th>Barcode</th>
                        </tr>
                    </thead>
                    <tbody>${variantsRows}</tbody>
                </table>
            </div>
        </div>

        <div style="margin-top: 20px;">
            <h3 class="font-semibold text-white mb-2" style="font-size: 14px;"><i class="fa-solid fa-align-left text-cyan"></i> Extracted Clean Description</h3>
            <div class="modal-desc-box">${escapeHtml(product.description_text || 'No description text extracted.')}</div>
        </div>
    `;

    productModal.classList.remove('hidden');
}

function changeModalImage(src, element) {
    document.getElementById('modalMainImg').src = src;
    document.querySelectorAll('.modal-thumb-mini').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
}

closeModalBtn.addEventListener('click', () => {
    productModal.classList.add('hidden');
});

productModal.addEventListener('click', (e) => {
    if (e.target === productModal) {
        productModal.classList.add('hidden');
    }
});

// Terminal Toggle Collapsible
document.getElementById('toggleTerminalBtn').addEventListener('click', (e) => {
    const icon = e.currentTarget.querySelector('i');
    if (terminalLogs.style.display === 'none') {
        terminalLogs.style.display = 'flex';
        icon.className = 'fa-solid fa-chevron-up';
    } else {
        terminalLogs.style.display = 'none';
        icon.className = 'fa-solid fa-chevron-down';
    }
});

// Robust Blob File Downloader for Chrome/Edge/Firefox
async function triggerFileDownload(endpoint, defaultFilename) {
    try {
        showToast('Generating export file...', 'info');
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error(`Export request failed (${response.status})`);
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        showToast(`Export complete: ${defaultFilename}`, 'success');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    }
}

// Document Initialization
document.addEventListener('DOMContentLoaded', () => {
    initSSE();
    fetchProductsData();

    // Export Dropdown Click & Hover Fix
    const exportBtn = document.getElementById('exportBtn');
    const exportDropdown = document.querySelector('.export-dropdown');

    if (exportBtn && exportDropdown) {
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportDropdown.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!exportDropdown.contains(e.target)) {
                exportDropdown.classList.remove('active');
            }
        });
    }

    // Export links intercepted for clean Blob downloads
    document.querySelectorAll('#exportMenu a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = link.getAttribute('href');
            const fileName = link.getAttribute('download') || 'exported_data.xlsx';
            
            if (exportDropdown) {
                exportDropdown.classList.remove('active');
            }
            
            triggerFileDownload(url, fileName);
        });
    });
});

// ===== APPLICATION STATE =====
class AmazonScraperApp {
    constructor() {
        this.products = [];
        this.currentProduct = null;
        this.isEditing = false;
        this.filters = {
            search: '',
            brand: '',
            category: ''
        };

        // DOM elements
        this.elements = {
            productUrl: document.getElementById('productUrl'),
            extractBtn: document.getElementById('extractBtn'),
            productEditor: document.getElementById('productEditor'),
            productForm: document.getElementById('productForm'),
            saveBtn: document.getElementById('saveBtn'),
            cancelBtn: document.getElementById('cancelBtn'),
            productsList: document.getElementById('productsList'),
            productCount: document.getElementById('productCount'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingText: document.getElementById('loadingText'),
            toastContainer: document.getElementById('toastContainer'),
            searchInput: document.getElementById('searchInput'),
            brandFilter: document.getElementById('brandFilter'),
            categoryFilter: document.getElementById('categoryFilter'),
            clearFilters: document.getElementById('clearFilters'),
            exportBtn: document.getElementById('exportBtn'),
            clearAllBtn: document.getElementById('clearAllBtn'),
            productModal: document.getElementById('productModal'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            modalClose: document.getElementById('modalClose'),
            modalEdit: document.getElementById('modalEdit'),
            modalDelete: document.getElementById('modalDelete'),
            modalDownload: document.getElementById('modalDownload')
        };

        this.init();
    }

    // ===== INITIALIZATION =====
    init() {
        this.loadProducts();
        this.bindEvents();
        this.updateFilters();
        this.renderProducts();
        this.setupChipInputs();
    }

    // ===== EVENT BINDING =====
    bindEvents() {
        // URL extraction
        this.elements.extractBtn.addEventListener('click', () => this.extractProduct());
        this.elements.productUrl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.extractProduct();
        });

        // Product editing
        this.elements.saveBtn.addEventListener('click', () => this.saveProduct());
        this.elements.cancelBtn.addEventListener('click', () => this.cancelEditing());

        // Search and filters
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.elements.brandFilter.addEventListener('change', (e) => this.handleBrandFilter(e.target.value));
        this.elements.categoryFilter.addEventListener('change', (e) => this.handleCategoryFilter(e.target.value));
        this.elements.clearFilters.addEventListener('click', () => this.clearFilters());

        // Bulk actions
        this.elements.exportBtn.addEventListener('click', () => this.exportAllProducts());
        this.elements.clearAllBtn.addEventListener('click', () => this.clearAllProducts());

        // Modal events
        this.elements.modalClose.addEventListener('click', () => this.closeModal());
        this.elements.modalEdit.addEventListener('click', () => this.editProductFromModal());
        this.elements.modalDelete.addEventListener('click', () => this.deleteProductFromModal());
        this.elements.modalDownload.addEventListener('click', () => this.downloadProductFromModal());

        // Close modal on outside click
        this.elements.productModal.addEventListener('click', (e) => {
            if (e.target === this.elements.productModal) this.closeModal();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
                this.cancelEditing();
            }
        });
    }

    // ===== CHIP INPUT SETUP =====
    setupChipInputs() {
        const chipInputs = [
            { input: 'colorInput', container: 'colorChips', property: 'colors' },
            { input: 'categoryInput', container: 'categoryChips', property: 'categories' },
            { input: 'tagInput', container: 'tagChips', property: 'tags' }
        ];

        chipInputs.forEach(({ input, container, property }) => {
            const inputEl = document.getElementById(input);
            const containerEl = document.getElementById(container);

            inputEl.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                    e.preventDefault();
                    this.addChip(containerEl, e.target.value.trim(), property);
                    e.target.value = '';
                }
            });
        });
    }

    // ===== CHIP MANAGEMENT =====
    addChip(container, value, property) {
        if (!value) return;

        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.innerHTML = `
            <span>${this.escapeHtml(value)}</span>
            <button type="button" class="chip-remove" onclick="this.parentElement.remove()">×</button>
        `;
        
        container.appendChild(chip);
    }

    getChipValues(containerId) {
        const container = document.getElementById(containerId);
        return Array.from(container.querySelectorAll('.chip span')).map(span => span.textContent);
    }

    setChipValues(containerId, values) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        
        if (values && values.length) {
            values.forEach(value => {
                this.addChip(container, value);
            });
        }
    }

    // ===== PRODUCT EXTRACTION =====
    async extractProduct() {
        const url = this.elements.productUrl.value.trim();
        
        if (!url) {
            this.showToast('Please enter a product URL', 'error');
            return;
        }

        if (!this.isValidAmazonUrl(url)) {
            this.showToast('Please enter a valid Amazon product URL', 'error');
            return;
        }

        this.showLoading('Extracting product data...');
        this.setButtonLoading(this.elements.extractBtn, true);

        try {
            const response = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const productData = await response.json();
            
            if (productData.error) {
                throw new Error(productData.error);
            }

            this.currentProduct = {
                id: Date.now(),
                url: url,
                extractedAt: new Date().toISOString(),
                ...productData
            };

            this.populateForm(this.currentProduct);
            this.showProductEditor();
            this.showToast('Product data extracted successfully!', 'success');

            // Auto-download images
            if (productData.images && productData.images.length > 0) {
                this.downloadProductImages(this.currentProduct);
            }

        } catch (error) {
            console.error('Extraction error:', error);
            this.showToast(`Extraction failed: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
            this.setButtonLoading(this.elements.extractBtn, false);
        }
    }

    // ===== URL VALIDATION =====
    isValidAmazonUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.includes('amazon.') && 
                   (urlObj.pathname.includes('/dp/') || urlObj.pathname.includes('/gp/product/'));
        } catch {
            return false;
        }
    }

    // ===== FORM MANAGEMENT =====
    populateForm(product) {
        // Basic fields
        document.getElementById('productTitle').value = product.title || '';
        document.getElementById('productBrand').value = product.brand || '';
        document.getElementById('productModel').value = product.model || '';
        document.getElementById('productASIN').value = product.asin || '';
        document.getElementById('productRating').value = product.rating || '';
        document.getElementById('ratingCount').value = product.ratingCount || '';
        document.getElementById('originalPrice').value = product.originalPrice || '';
        document.getElementById('offerPrice').value = product.offerPrice || '';
        document.getElementById('offerPercentage').value = product.offerPercentage || '';
        document.getElementById('amountSaved').value = product.amountSaved || '';
        document.getElementById('aboutItem').value = product.aboutItem || '';
        document.getElementById('technicalData').value = product.technicalData || '';

        // Chip fields
        this.setChipValues('colorChips', product.colors || []);
        this.setChipValues('categoryChips', product.categories || []);
        this.setChipValues('tagChips', product.tags || []);

        // Images
        this.displayImages(product.images || []);
    }

    getFormData() {
        return {
            title: document.getElementById('productTitle').value,
            brand: document.getElementById('productBrand').value,
            model: document.getElementById('productModel').value,
            asin: document.getElementById('productASIN').value,
            rating: document.getElementById('productRating').value,
            ratingCount: document.getElementById('ratingCount').value,
            originalPrice: document.getElementById('originalPrice').value,
            offerPrice: document.getElementById('offerPrice').value,
            offerPercentage: document.getElementById('offerPercentage').value,
            amountSaved: document.getElementById('amountSaved').value,
            aboutItem: document.getElementById('aboutItem').value,
            technicalData: document.getElementById('technicalData').value,
            colors: this.getChipValues('colorChips'),
            categories: this.getChipValues('categoryChips'),
            tags: this.getChipValues('tagChips')
        };
    }

    // ===== IMAGE HANDLING =====
    displayImages(images) {
        const container = document.getElementById('imagePreview');
        container.innerHTML = '';

        if (!images || !images.length) {
            container.innerHTML = '<p class="text-muted">No images available</p>';
            return;
        }

        images.forEach((image, index) => {
            const imageDiv = document.createElement('div');
            imageDiv.className = 'image-item';
            imageDiv.innerHTML = `
                <img src="${this.escapeHtml(image.url)}" alt="Product image ${index + 1}" loading="lazy">
                <div class="image-overlay">
                    Image ${index + 1}
                    ${image.downloaded ? '✓' : '⏳'}
                </div>
            `;
            container.appendChild(imageDiv);
        });
    }

    async downloadProductImages(product) {
        if (!product.images || !product.images.length) return;

        const statusContainer = document.getElementById('imageDownloadStatus');
        statusContainer.innerHTML = '<h4>Downloading Images...</h4>';

        for (let i = 0; i < product.images.length; i++) {
            const image = product.images[i];
            const statusItem = document.createElement('div');
            statusItem.className = 'download-item';
            statusItem.innerHTML = `
                <span>Image ${i + 1}</span>
                <span class="download-status">Downloading...</span>
            `;
            statusContainer.appendChild(statusItem);

            try {
                const response = await fetch('/api/download-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        url: image.url, 
                        productId: product.id, 
                        index: i,
                        productTitle: product.title 
                    })
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    
                    // Auto-download
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${this.sanitizeFileName(product.title)}-image-${i + 1}.jpg`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    statusItem.querySelector('.download-status').textContent = 'Downloaded ✓';
                    image.downloaded = true;
                } else {
                    statusItem.querySelector('.download-status').textContent = 'Failed ✗';
                }
            } catch (error) {
                console.error('Image download error:', error);
                statusItem.querySelector('.download-status').textContent = 'Failed ✗';
            }
        }

        this.showToast(`Images downloaded to folder: ${this.sanitizeFileName(product.title)}`, 'success');
    }

    sanitizeFileName(fileName) {
        if (!fileName) return 'unknown-product';
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 50);
    }

    // ===== PRODUCT MANAGEMENT =====
    showProductEditor() {
        this.elements.productEditor.style.display = 'block';
        this.elements.productEditor.scrollIntoView({ behavior: 'smooth' });
        this.isEditing = true;
    }

    hideProductEditor() {
        this.elements.productEditor.style.display = 'none';
        this.isEditing = false;
        this.currentProduct = null;
    }

    saveProduct() {
        if (!this.currentProduct) return;

        const formData = this.getFormData();
        
        // Validation
        if (!formData.title.trim()) {
            this.showToast('Product title is required', 'error');
            return;
        }

        // Update current product
        Object.assign(this.currentProduct, formData);
        this.currentProduct.updatedAt = new Date().toISOString();

        // Add or update in products array
        const existingIndex = this.products.findIndex(p => p.id === this.currentProduct.id);
        if (existingIndex !== -1) {
            this.products[existingIndex] = this.currentProduct;
        } else {
            this.products.push(this.currentProduct);
        }

        this.saveProducts();
        this.renderProducts();
        this.updateFilters();
        this.hideProductEditor();
        this.clearForm();
        this.elements.productUrl.value = '';

        this.showToast('Product saved successfully!', 'success');
    }

    cancelEditing() {
        if (this.isEditing) {
            this.hideProductEditor();
            this.clearForm();
            this.elements.productUrl.value = '';
            this.currentProduct = null;
        }
    }

    editProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        this.currentProduct = { ...product };
        this.populateForm(this.currentProduct);
        this.showProductEditor();
        this.closeModal();
    }

    deleteProduct(productId) {
        if (confirm('Are you sure you want to delete this product?')) {
            this.products = this.products.filter(p => p.id !== productId);
            this.saveProducts();
            this.renderProducts();
            this.updateFilters();
            this.closeModal();
            this.showToast('Product deleted successfully', 'success');
        }
    }

    clearForm() {
        const form = this.elements.productForm;
        form.reset();
        
        // Clear chip containers
        document.getElementById('colorChips').innerHTML = '';
        document.getElementById('categoryChips').innerHTML = '';
        document.getElementById('tagChips').innerHTML = '';
        
        // Clear image preview
        document.getElementById('imagePreview').innerHTML = '';
        document.getElementById('imageDownloadStatus').innerHTML = '';
    }

    // ===== PRODUCT RENDERING =====
    renderProducts() {
        const filteredProducts = this.getFilteredProducts();
        this.elements.productCount.textContent = filteredProducts.length;

        if (filteredProducts.length === 0) {
            this.elements.productsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📦</div>
                    <h3>No products found</h3>
                    <p>${this.products.length === 0 ? 'Enter an Amazon product URL above to get started!' : 'Try adjusting your search filters.'}</p>
                </div>
            `;
            return;
        }

        this.elements.productsList.innerHTML = filteredProducts.map(product => this.createProductCard(product)).join('');
    }

    createProductCard(product) {
        const rating = product.rating ? parseFloat(product.rating) : 0;
        const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating));
        
        return `
            <div class="product-card" data-id="${product.id}">
                <div class="product-header">
                    <h3 class="product-title">${this.escapeHtml(product.title || 'Untitled Product')}</h3>
                    <div class="product-actions">
                        <button class="action-btn" onclick="app.viewProduct(${product.id})" title="View Details">👁️</button>
                        <button class="action-btn" onclick="app.editProduct(${product.id})" title="Edit">✏️</button>
                        <button class="action-btn" onclick="app.deleteProduct(${product.id})" title="Delete">🗑️</button>
                        <button class="action-btn" onclick="app.downloadProduct(${product.id})" title="Download">💾</button>
                    </div>
                </div>
                
                <div class="product-info">
                    ${product.brand ? `
                        <div class="info-row">
                            <span class="info-label">Brand:</span>
                            <span class="info-value">${this.escapeHtml(product.brand)}</span>
                        </div>
                    ` : ''}
                    
                    ${product.model ? `
                        <div class="info-row">
                            <span class="info-label">Model:</span>
                            <span class="info-value">${this.escapeHtml(product.model)}</span>
                        </div>
                    ` : ''}
                    
                    ${product.asin ? `
                        <div class="info-row">
                            <span class="info-label">ASIN:</span>
                            <span class="info-value">${this.escapeHtml(product.asin)}</span>
                        </div>
                    ` : ''}
                    
                    ${rating > 0 ? `
                        <div class="info-row">
                            <span class="info-label">Rating:</span>
                            <div class="rating-display">
                                <span class="stars">${stars}</span>
                                <span class="info-value">${rating}</span>
                                ${product.ratingCount ? `<span class="rating-count">(${product.ratingCount})</span>` : ''}
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                ${(product.originalPrice || product.offerPrice) ? `
                    <div class="price-info">
                        ${product.originalPrice && product.offerPrice ? `
                            <div class="price-row">
                                <span class="original-price">${this.escapeHtml(product.originalPrice)}</span>
                                <span class="offer-price">${this.escapeHtml(product.offerPrice)}</span>
                            </div>
                            ${product.offerPercentage ? `
                                <div class="price-row">
                                    <span class="discount">${this.escapeHtml(product.offerPercentage)} OFF</span>
                                    ${product.amountSaved ? `<span class="info-value">Save ${this.escapeHtml(product.amountSaved)}</span>` : ''}
                                </div>
                            ` : ''}
                        ` : `
                            <div class="price-row">
                                <span class="offer-price">${this.escapeHtml(product.offerPrice || product.originalPrice || 'Price not available')}</span>
                            </div>
                        `}
                    </div>
                ` : ''}
                
                ${this.renderChipList('Colors', product.colors)}
                ${this.renderChipList('Categories', product.categories)}
                ${this.renderChipList('Tags', product.tags)}
                
                <div class="info-row">
                    <span class="info-label">Added:</span>
                    <span class="info-value">${new Date(product.extractedAt).toLocaleDateString()}</span>
                </div>
            </div>
        `;
    }

    renderChipList(label, items) {
        if (!items || !items.length) return '';
        
        return `
            <div class="info-row">
                <span class="info-label">${label}:</span>
                <div class="chip-list">
                    ${items.slice(0, 3).map(item => `<span class="mini-chip">${this.escapeHtml(item)}</span>`).join('')}
                    ${items.length > 3 ? `<span class="mini-chip">+${items.length - 3} more</span>` : ''}
                </div>
            </div>
        `;
    }

    // ===== MODAL MANAGEMENT =====
    viewProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        this.currentModalProduct = product;
        this.elements.modalTitle.textContent = product.title || 'Product Details';
        this.elements.modalBody.innerHTML = this.createProductDetailView(product);
        this.elements.productModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    createProductDetailView(product) {
        const rating = product.rating ? parseFloat(product.rating) : 0;
        const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating));

        return `
            <div class="product-detail">
                <div class="detail-section">
                    <h3>Basic Information</h3>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <div class="detail-label">Title</div>
                            <div class="detail-value">${this.escapeHtml(product.title || 'N/A')}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">Brand</div>
                            <div class="detail-value">${this.escapeHtml(product.brand || 'N/A')}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">Model</div>
                            <div class="detail-value">${this.escapeHtml(product.model || 'N/A')}</div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">ASIN</div>
                            <div class="detail-value">${this.escapeHtml(product.asin || 'N/A')}</div>
                        </div>
                        ${rating > 0 ? `
                            <div class="detail-item">
                                <div class="detail-label">Rating</div>
                                <div class="detail-value">
                                    <div class="rating-display">
                                        <span class="stars">${stars}</span>
                                        <span>${rating}</span>
                                        ${product.ratingCount ? `<span class="rating-count">(${product.ratingCount} reviews)</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>

                ${(product.originalPrice || product.offerPrice) ? `
                    <div class="detail-section">
                        <h3>Pricing Information</h3>
                        <div class="detail-grid">
                            ${product.originalPrice ? `
                                <div class="detail-item">
                                    <div class="detail-label">Original Price</div>
                                    <div class="detail-value">${this.escapeHtml(product.originalPrice)}</div>
                                </div>
                            ` : ''}
                            ${product.offerPrice ? `
                                <div class="detail-item">
                                    <div class="detail-label">Offer Price</div>
                                    <div class="detail-value offer-price">${this.escapeHtml(product.offerPrice)}</div>
                                </div>
                            ` : ''}
                            ${product.offerPercentage ? `
                                <div class="detail-item">
                                    <div class="detail-label">Discount</div>
                                    <div class="detail-value">${this.escapeHtml(product.offerPercentage)}</div>
                                </div>
                            ` : ''}
                            ${product.amountSaved ? `
                                <div class="detail-item">
                                    <div class="detail-label">Amount Saved</div>
                                    <div class="detail-value">${this.escapeHtml(product.amountSaved)}</div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${(product.colors && product.colors.length) || (product.categories && product.categories.length) || (product.tags && product.tags.length) ? `
                    <div class="detail-section">
                        <h3>Categories & Tags</h3>
                        <div class="detail-grid">
                            ${product.colors && product.colors.length ? `
                                <div class="detail-item">
                                    <div class="detail-label">Colors/Types</div>
                                    <div class="detail-value">
                                        <div class="chip-list">
                                            ${product.colors.map(color => `<span class="mini-chip">${this.escapeHtml(color)}</span>`).join('')}
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                            ${product.categories && product.categories.length ? `
                                <div class="detail-item">
                                    <div class="detail-label">Categories</div>
                                    <div class="detail-value">
                                        <div class="chip-list">
                                            ${product.categories.map(category => `<span class="mini-chip">${this.escapeHtml(category)}</span>`).join('')}
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                            ${product.tags && product.tags.length ? `
                                <div class="detail-item">
                                    <div class="detail-label">Tags</div>
                                    <div class="detail-value">
                                        <div class="chip-list">
                                            ${product.tags.map(tag => `<span class="mini-chip">${this.escapeHtml(tag)}</span>`).join('')}
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${product.aboutItem ? `
                    <div class="detail-section">
                        <h3>About This Item</h3>
                        <div class="detail-value">${this.escapeHtml(product.aboutItem).replace(/\n/g, '<br>')}</div>
                    </div>
                ` : ''}

                ${product.technicalData ? `
                    <div class="detail-section">
                        <h3>Technical Specifications</h3>
                        <div class="detail-value">${this.escapeHtml(product.technicalData).replace(/\n/g, '<br>')}</div>
                    </div>
                ` : ''}

                ${product.images && product.images.length ? `
                    <div class="detail-section">
                        <h3>Product Images</h3>
                        <div class="detail-images">
                            ${product.images.map((image, index) => `
                                <div class="detail-image">
                                    <img src="${this.escapeHtml(image.url)}" alt="Product image ${index + 1}" loading="lazy">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div class="detail-section">
                    <h3>Metadata</h3>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <div class="detail-label">Original URL</div>
                            <div class="detail-value">
                                <a href="${this.escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">
                                    View on Amazon
                                </a>
                            </div>
                        </div>
                        <div class="detail-item">
                            <div class="detail-label">Extracted At</div>
                            <div class="detail-value">${new Date(product.extractedAt).toLocaleString()}</div>
                        </div>
                        ${product.updatedAt ? `
                            <div class="detail-item">
                                <div class="detail-label">Last Updated</div>
                                <div class="detail-value">${new Date(product.updatedAt).toLocaleString()}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    closeModal() {
        this.elements.productModal.style.display = 'none';
        document.body.style.overflow = '';
        this.currentModalProduct = null;
    }

    editProductFromModal() {
        if (this.currentModalProduct) {
            this.editProduct(this.currentModalProduct.id);
        }
    }

    deleteProductFromModal() {
        if (this.currentModalProduct) {
            this.deleteProduct(this.currentModalProduct.id);
        }
    }

    downloadProductFromModal() {
        if (this.currentModalProduct) {
            this.downloadProduct(this.currentModalProduct.id);
        }
    }

    // ===== SEARCH AND FILTERING =====
    getFilteredProducts() {
        return this.products.filter(product => {
            // Search filter
            if (this.filters.search) {
                const searchLower = this.filters.search.toLowerCase();
                const searchableText = [
                    product.title,
                    product.brand,
                    product.model,
                    product.asin,
                    ...(product.categories || []),
                    ...(product.tags || [])
                ].join(' ').toLowerCase();
                
                if (!searchableText.includes(searchLower)) {
                    return false;
                }
            }

            // Brand filter
            if (this.filters.brand && product.brand !== this.filters.brand) {
                return false;
            }

            // Category filter
            if (this.filters.category && (!product.categories || !product.categories.includes(this.filters.category))) {
                return false;
            }

            return true;
        });
    }

    handleSearch(searchTerm) {
        this.filters.search = searchTerm;
        this.renderProducts();
    }

    handleBrandFilter(brand) {
        this.filters.brand = brand;
        this.renderProducts();
    }

    handleCategoryFilter(category) {
        this.filters.category = category;
        this.renderProducts();
    }

    clearFilters() {
        this.filters = { search: '', brand: '', category: '' };
        this.elements.searchInput.value = '';
        this.elements.brandFilter.value = '';
        this.elements.categoryFilter.value = '';
        this.renderProducts();
    }

    updateFilters() {
        // Update brand filter
        const brands = [...new Set(this.products.map(p => p.brand).filter(Boolean))].sort();
        this.elements.brandFilter.innerHTML = '<option value="">All Brands</option>' +
            brands.map(brand => `<option value="${this.escapeHtml(brand)}">${this.escapeHtml(brand)}</option>`).join('');

        // Update category filter
        const categories = [...new Set(this.products.flatMap(p => p.categories || []))].sort();
        this.elements.categoryFilter.innerHTML = '<option value="">All Categories</option>' +
            categories.map(category => `<option value="${this.escapeHtml(category)}">${this.escapeHtml(category)}</option>`).join('');
    }

    // ===== DATA PERSISTENCE =====
    saveProducts() {
        try {
            localStorage.setItem('amazonScrapperProducts', JSON.stringify(this.products));
        } catch (error) {
            console.error('Failed to save products:', error);
            this.showToast('Failed to save products to local storage', 'error');
        }
    }

    loadProducts() {
        try {
            const saved = localStorage.getItem('amazonScrapperProducts');
            this.products = saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load products:', error);
            this.products = [];
            this.showToast('Failed to load saved products', 'error');
        }
    }

    // ===== EXPORT AND IMPORT =====
    exportAllProducts() {
        if (this.products.length === 0) {
            this.showToast('No products to export', 'warning');
            return;
        }

        try {
            const dataStr = JSON.stringify(this.products, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `amazon-products-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showToast(`Exported ${this.products.length} products successfully!`, 'success');
        } catch (error) {
            console.error('Export error:', error);
            this.showToast('Failed to export products', 'error');
        }
    }

    downloadProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        try {
            const dataStr = JSON.stringify(product, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `product-${product.asin || product.id}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showToast('Product downloaded successfully!', 'success');
        } catch (error) {
            console.error('Download error:', error);
            this.showToast('Failed to download product', 'error');
        }
    }

    clearAllProducts() {
        if (this.products.length === 0) {
            this.showToast('No products to clear', 'warning');
            return;
        }

        if (confirm(`Are you sure you want to delete all ${this.products.length} products? This action cannot be undone.`)) {
            this.products = [];
            this.saveProducts();
            this.renderProducts();
            this.updateFilters();
            this.showToast('All products cleared successfully', 'success');
        }
    }

    // ===== UI UTILITIES =====
    showLoading(message = 'Loading...') {
        this.elements.loadingText.textContent = message;
        this.elements.loadingOverlay.style.display = 'flex';
    }

    hideLoading() {
        this.elements.loadingOverlay.style.display = 'none';
    }

    setButtonLoading(button, loading) {
        const textEl = button.querySelector('.btn-text');
        const spinnerEl = button.querySelector('.spinner');
        
        if (loading) {
            if (textEl) textEl.style.display = 'none';
            if (spinnerEl) spinnerEl.style.display = 'block';
            button.disabled = true;
        } else {
            if (textEl) textEl.style.display = 'block';
            if (spinnerEl) spinnerEl.style.display = 'none';
            button.disabled = false;
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${this.escapeHtml(message)}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">×</button>
        `;

        this.elements.toastContainer.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 5000);
    }

    escapeHtml(text) {
        if (typeof text !== 'string') return text;
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ===== APPLICATION INITIALIZATION =====
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new AmazonScraperApp();
    
    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
        if (app) {
            app.showToast('An unexpected error occurred', 'error');
        }
    });

    // Handle online/offline status
    window.addEventListener('online', () => {
        if (app) app.showToast('Connection restored', 'success');
    });

    window.addEventListener('offline', () => {
        if (app) app.showToast('You are now offline. Some features may not work.', 'warning');
    });
});

// ===== GLOBAL UTILITY FUNCTIONS =====
// These functions are called from inline onclick handlers in the HTML

window.viewProduct = (id) => app?.viewProduct(id);
window.editProduct = (id) => app?.editProduct(id);
window.deleteProduct = (id) => app?.deleteProduct(id);
window.downloadProduct = (id) => app?.downloadProduct(id);
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;
const pipelineAsync = promisify(pipeline);

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files with proper MIME types
app.use(express.static(__dirname, {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (path.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json');
        }
    }
}));

// Create downloads directory if it doesn't exist
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
fs.mkdir(DOWNLOADS_DIR, { recursive: true }).catch(console.error);

// ===== SCRAPING SERVICE =====
class AmazonScraper {
    constructor() {
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
        ];
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    async scrapeProduct(url) {
        try {
            console.log(`Scraping product: ${url}`);
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0'
                },
                timeout: 30000,
                maxRedirects: 5
            });

            const $ = cheerio.load(response.data);
            const productData = {};

            // Extract basic product information
            productData.title = this.extractTitle($);
            productData.brand = this.extractBrand($);
            productData.model = this.extractModel($);
            productData.asin = this.extractASIN($, url);
            
            // Extract pricing information
            const pricing = this.extractPricing($);
            Object.assign(productData, pricing);
            
            // Extract rating information
            const rating = this.extractRating($);
            Object.assign(productData, rating);
            
            // Extract additional information
            productData.colors = this.extractColors($);
            productData.aboutItem = this.extractAboutItem($);
            productData.technicalData = this.extractTechnicalData($);
            productData.images = this.extractImages($);

            // Add default categories and tags
            productData.categories = this.extractCategories($);
            productData.tags = this.generateTags(productData);

            console.log('Successfully scraped product:', productData.title);
            return productData;

        } catch (error) {
            console.error('Scraping error:', error.message);
            throw new Error(`Failed to scrape product: ${error.message}`);
        }
    }

    extractTitle($) {
        const selectors = [
            '#productTitle',
            '.product-title',
            '[data-cy="product-title"]',
            'h1.a-size-large.a-spacing-none',
            'h1 span'
        ];

        for (const selector of selectors) {
            const title = $(selector).first().text().trim();
            if (title) return title;
        }
        
        return '';
    }

    extractBrand($) {
        const selectors = [
            '#bylineInfo',
            '.a-link-normal[href*="/stores/"]',
            'a[data-brand]',
            '.po-brand .po-break-word',
            '#brandNameHeading',
            '[data-cy="brand-name"]'
        ];

        for (const selector of selectors) {
            const brand = $(selector).first().text().trim();
            if (brand && !brand.toLowerCase().includes('visit') && !brand.toLowerCase().includes('store')) {
                return brand.replace(/^Brand:\s*/i, '').replace(/^by\s+/i, '');
            }
        }

        // Try to extract brand from title
        const title = this.extractTitle($);
        if (title) {
            const brandMatch = title.match(/^([A-Z][a-zA-Z\s&-]+?)[\s-]+/);
            if (brandMatch) {
                return brandMatch[1].trim();
            }
        }

        return '';
    }

    extractModel($) {
        const selectors = [
            '.po-model_name .po-break-word',
            '[data-cy="model-name"]',
            '#model_name',
            '.model-name'
        ];

        for (const selector of selectors) {
            const model = $(selector).first().text().trim();
            if (model) return model;
        }

        // Look in technical details
        const techDetails = $('#tech tbody tr, #productDetails_detailBullets_sections1 tbody tr');
        let foundModel = '';
        techDetails.each((i, row) => {
            const label = $(row).find('td:first-child, th:first-child').text().trim().toLowerCase();
            if (label.includes('model') && !label.includes('number')) {
                const value = $(row).find('td:last-child').text().trim();
                if (value && value !== 'N/A' && value !== '-') {
                    foundModel = value;
                    return false; // Break the loop
                }
            }
        });

        return foundModel;
    }

    extractASIN($, url) {
        // Try to get ASIN from URL first
        const asinMatch = url.match(/\/([A-Z0-9]{10})\//);
        if (asinMatch) return asinMatch[1];

        // Try to find ASIN in page data
        const selectors = [
            '[data-asin]',
            '#ASIN',
            'input[name="ASIN"]'
        ];

        for (const selector of selectors) {
            const asin = $(selector).attr('value') || $(selector).attr('data-asin');
            if (asin && /^[A-Z0-9]{10}$/.test(asin)) return asin;
        }

        return '';
    }

    extractPricing($) {
        const pricing = {};

        // Try multiple approaches for price extraction
        console.log('Extracting pricing information...');

        // Method 1: Standard Amazon price selectors
        const priceSelectors = {
            current: [
                '.a-price.a-text-normal .a-offscreen',
                '.a-price-current .a-offscreen', 
                '.a-price .a-offscreen',
                '#apex_desktop .a-price .a-offscreen',
                '.a-price-whole',
                '#price_inside_buybox',
                '.a-price-symbol + .a-price-whole'
            ],
            original: [
                '.a-price.a-text-price .a-offscreen',
                '.a-text-strike .a-offscreen',
                '.a-price-was .a-offscreen',
                '.a-text-price',
                '#listPrice .a-offscreen',
                '[data-cy="original-price"]'
            ],
            discount: [
                '.a-badge-text',
                '.savingsPercentage',
                '.a-size-large.a-color-price',
                '[data-cy="discount-percentage"]',
                '.a-text-bold.a-color-price'
            ]
        };

        // Extract current/offer price
        let currentPrice = '';
        for (const selector of priceSelectors.current) {
            const price = $(selector).first().text().trim();
            console.log(`Trying current price selector "${selector}":`, price);
            if (price && price.match(/\$[\d,]+\.?\d*/)) {
                currentPrice = price;
                console.log('Found current price:', currentPrice);
                break;
            }
        }

        // Extract original price (if different from current)
        let originalPrice = '';
        for (const selector of priceSelectors.original) {
            const price = $(selector).first().text().trim();
            console.log(`Trying original price selector "${selector}":`, price);
            if (price && price.match(/\$[\d,]+\.?\d*/) && price !== currentPrice) {
                originalPrice = price;
                console.log('Found original price:', originalPrice);
                break;
            }
        }

        // Method 2: Try alternative price extraction from spans
        if (!currentPrice) {
            const spans = $('span').filter((i, el) => {
                const text = $(el).text().trim();
                return text.match(/^\$[\d,]+\.?\d*$/) && text.length < 15;
            });
            
            spans.each((i, el) => {
                const price = $(el).text().trim();
                if (!currentPrice && price.match(/\$[\d,]+\.?\d*/)) {
                    currentPrice = price;
                    console.log('Found price from span:', currentPrice);
                    return false;
                }
            });
        }

        // Set prices
        if (currentPrice) {
            pricing.offerPrice = currentPrice;
        }
        
        if (originalPrice) {
            pricing.originalPrice = originalPrice;
        } else if (currentPrice) {
            pricing.originalPrice = currentPrice;
        }

        // Extract discount percentage
        for (const selector of priceSelectors.discount) {
            const discount = $(selector).first().text().trim();
            console.log(`Trying discount selector "${selector}":`, discount);
            if (discount && discount.match(/\d+%/)) {
                pricing.offerPercentage = discount;
                console.log('Found discount:', discount);
                break;
            }
        }

        // Calculate savings if we have both prices
        if (pricing.originalPrice && pricing.offerPrice && pricing.originalPrice !== pricing.offerPrice) {
            try {
                const originalNum = parseFloat(pricing.originalPrice.replace(/[^0-9.]/g, ''));
                const offerNum = parseFloat(pricing.offerPrice.replace(/[^0-9.]/g, ''));
                
                if (originalNum > offerNum) {
                    const saved = originalNum - offerNum;
                    pricing.amountSaved = `${saved.toFixed(2)}`;
                    
                    // Calculate percentage if not found
                    if (!pricing.offerPercentage) {
                        const percentage = Math.round((saved / originalNum) * 100);
                        pricing.offerPercentage = `${percentage}% off`;
                    }
                    
                    console.log('Calculated savings:', pricing.amountSaved);
                }
            } catch (error) {
                console.warn('Error calculating savings:', error);
            }
        }

        // Method 3: Try to find price in JSON-LD data
        if (!currentPrice) {
            const jsonLdScript = $('script[type="application/ld+json"]');
            jsonLdScript.each((i, script) => {
                try {
                    const data = JSON.parse($(script).text());
                    if (data.offers && data.offers.price) {
                        pricing.offerPrice = `${data.offers.price}`;
                        console.log('Found price in JSON-LD:', pricing.offerPrice);
                    }
                } catch (e) {
                    // Ignore JSON parsing errors
                }
            });
        }

        console.log('Final pricing data:', pricing);
        return pricing;
    }

    extractRating($) {
        const rating = {};

        // Rating value selectors
        const ratingSelectors = [
            '.a-icon-alt',
            '[data-cy="reviews-ratings-slot"] .a-icon-alt',
            '.reviewCountTextLinkedHistogram .a-icon-alt',
            '#acrPopover .a-icon-alt'
        ];

        for (const selector of ratingSelectors) {
            const ratingText = $(selector).first().text().trim();
            const match = ratingText.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
            if (match) {
                rating.rating = match[1];
                break;
            }
        }

        // Rating count selectors
        const countSelectors = [
            '#acrCustomerReviewText',
            '[data-cy="reviews-ratings-slot"] a[href*="reviews"]',
            '.reviewCountTextLinkedHistogram a',
            '#averageCustomerReviews a'
        ];

        for (const selector of countSelectors) {
            const countText = $(selector).first().text().trim();
            const match = countText.match(/([0-9,]+)/);
            if (match) {
                rating.ratingCount = match[1];
                break;
            }
        }

        return rating;
    }

    extractColors($) {
        const colors = [];
        
        const colorSelectors = [
            '#variation_color_name li',
            '.a-button-thumbnail img',
            '[data-cy="color-name"]',
            '#color_name_list li',
            '.swatches li'
        ];

        colorSelectors.forEach(selector => {
            $(selector).each((i, el) => {
                const $el = $(el);
                let colorName = '';
                
                // Try different ways to get color name
                colorName = $el.attr('title') || 
                           $el.attr('alt') || 
                           $el.text().trim() ||
                           $el.find('img').attr('alt') ||
                           $el.find('img').attr('title');
                
                if (colorName && !colors.includes(colorName) && colorName.length > 1) {
                    colors.push(colorName);
                }
            });
        });

        return colors.slice(0, 10); // Limit to 10 colors
    }

    extractAboutItem($) {
        const aboutSelectors = [
            '#feature-bullets ul li span',
            '[data-cy="item-bullets"] li',
            '#productDescription p',
            '.a-unordered-list.a-vertical.a-spacing-none li span'
        ];

        let aboutText = '';

        for (const selector of aboutSelectors) {
            const items = [];
            $(selector).each((i, el) => {
                const text = $(el).text().trim();
                if (text && text.length > 10 && !text.toLowerCase().includes('see more')) {
                    items.push(text);
                }
            });
            
            if (items.length > 0) {
                aboutText = items.join('\n• ');
                break;
            }
        }

        return aboutText ? `• ${aboutText}` : '';
    }

    extractTechnicalData($) {
        const techData = [];

        // Technical details selectors
        const techSelectors = [
            '#tech tbody tr',
            '#productDetails_detailBullets_sections1 tbody tr',
            '#productDetails_techSpec_section_1 tbody tr',
            '.a-keyvalue tbody tr'
        ];

        techSelectors.forEach(selector => {
            $(selector).each((i, row) => {
                const $row = $(row);
                const label = $row.find('td:first-child, th:first-child').text().trim();
                const value = $row.find('td:last-child, td:nth-child(2)').text().trim();
                
                if (label && value && value !== 'N/A' && value !== '-' && value !== '‎') {
                    techData.push(`${label}: ${value}`);
                }
            });
            
            if (techData.length > 0) return false; // Stop after finding data
        });

        return techData.join('\n');
    }

    extractImages($) {
        const images = [];
        const seenUrls = new Set();

        const imageSelectors = [
            '#altImages img',
            '#imageBlock img',
            '.a-dynamic-image',
            '#main-image',
            '[data-cy="product-image"]'
        ];

        imageSelectors.forEach(selector => {
            $(selector).each((i, img) => {
                const $img = $(img);
                let src = $img.attr('data-old-hires') || 
                         $img.attr('data-large-image-url') ||
                         $img.attr('data-src') ||
                         $img.attr('src');

                if (src) {
                    // Clean up the URL and get high-res version
                    src = src.replace(/\._[A-Z]{2}[0-9]+_/, '._AC_SX500_')
                             .replace(/\._.*?\./, '._AC_SX500_.');
                    
                    if (!seenUrls.has(src) && src.includes('amazon') && !src.includes('sprite')) {
                        seenUrls.add(src);
                        images.push({
                            url: src,
                            alt: $img.attr('alt') || `Product image ${images.length + 1}`,
                            downloaded: false
                        });
                    }
                }
            });
        });

        return images.slice(0, 6); // Limit to 6 images
    }

    extractCategories($) {
        const categories = [];
        
        // Breadcrumb selectors
        const breadcrumbSelectors = [
            '#wayfinding-breadcrumbs_container a',
            '.a-breadcrumb a',
            '#nav-subnav a',
            '[data-cy="breadcrumb"] a'
        ];

        breadcrumbSelectors.forEach(selector => {
            $(selector).each((i, el) => {
                const category = $(el).text().trim();
                if (category && 
                    category.length > 2 && 
                    !category.toLowerCase().includes('amazon') &&
                    !categories.includes(category)) {
                    categories.push(category);
                }
            });
            
            if (categories.length > 0) return false; // Stop after finding categories
        });

        return categories.slice(0, 5); // Limit to 5 categories
    }

    generateTags(productData) {
        const tags = [];
        
        // Add tags based on product data
        if (productData.brand) {
            tags.push(productData.brand);
        }
        
        if (productData.rating && parseFloat(productData.rating) >= 4.0) {
            tags.push('Highly Rated');
        }
        
        if (productData.offerPercentage) {
            const discount = parseInt(productData.offerPercentage);
            if (discount >= 50) {
                tags.push('Great Deal');
            } else if (discount >= 20) {
                tags.push('Good Deal');
            }
        }

        // Add tags based on title keywords
        const title = productData.title?.toLowerCase() || '';
        const keywordTags = {
            'wireless': 'Wireless',
            'bluetooth': 'Bluetooth',
            'smart': 'Smart Device',
            'premium': 'Premium',
            'professional': 'Professional',
            'portable': 'Portable',
            'waterproof': 'Waterproof',
            'rechargeable': 'Rechargeable'
        };

        Object.entries(keywordTags).forEach(([keyword, tag]) => {
            if (title.includes(keyword) && !tags.includes(tag)) {
                tags.push(tag);
            }
        });

        return tags.slice(0, 8); // Limit to 8 tags
    }
}

// ===== IMAGE DOWNLOAD SERVICE =====
class ImageDownloader {
    constructor() {
        this.downloadQueue = new Map();
    }

    async downloadImage(imageUrl, productId, imageIndex, productTitle = '') {
        try {
            // Create product-specific folder
            const sanitizedTitle = this.sanitizeFileName(productTitle || `product-${productId}`);
            const productFolder = path.join(DOWNLOADS_DIR, sanitizedTitle);
            
            // Ensure product folder exists
            await fs.mkdir(productFolder, { recursive: true });

            const response = await axios({
                method: 'get',
                url: imageUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 30000
            });

            // Generate filename
            const extension = this.getImageExtension(imageUrl, response.headers['content-type']);
            const filename = `image-${imageIndex + 1}.${extension}`;
            const filepath = path.join(productFolder, filename);

            // Download and save the image
            const writer = createWriteStream(filepath);
            await pipelineAsync(response.data, writer);

            // Also save product info as JSON in the same folder
            const productInfoPath = path.join(productFolder, 'product-info.json');
            const productInfo = {
                productId,
                title: productTitle,
                downloadedAt: new Date().toISOString(),
                imageUrl: imageUrl,
                filename: filename
            };
            
            try {
                await fs.writeFile(productInfoPath, JSON.stringify(productInfo, null, 2));
            } catch (jsonError) {
                console.warn('Could not save product info JSON:', jsonError.message);
            }

            return {
                success: true,
                filename,
                filepath,
                productFolder,
                size: (await fs.stat(filepath)).size
            };

        } catch (error) {
            console.error('Image download error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    sanitizeFileName(fileName) {
        // Remove or replace invalid characters for folder names
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars with underscore
            .replace(/\s+/g, '_') // Replace spaces with underscore
            .replace(/_+/g, '_') // Replace multiple underscores with single
            .replace(/^_|_$/g, '') // Remove leading/trailing underscores
            .substring(0, 100); // Limit length to 100 characters
    }

    getImageExtension(url, contentType) {
        // Try to get extension from content type first
        if (contentType) {
            if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
            if (contentType.includes('png')) return 'png';
            if (contentType.includes('webp')) return 'webp';
            if (contentType.includes('gif')) return 'gif';
        }

        // Fall back to URL extension
        const urlExt = url.split('.').pop().split('?')[0].toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(urlExt)) {
            return urlExt;
        }

        return 'jpg'; // Default fallback
    }
}

// ===== INITIALIZE SERVICES =====
const scraper = new AmazonScraper();
const imageDownloader = new ImageDownloader();

// ===== API ROUTES =====

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Scrape product endpoint
app.post('/api/scrape', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate Amazon URL
        if (!url.includes('amazon.')) {
            return res.status(400).json({ error: 'Please provide a valid Amazon product URL' });
        }

        console.log('Received scrape request for:', url);

        const productData = await scraper.scrapeProduct(url);
        
        res.json(productData);

    } catch (error) {
        console.error('Scrape API error:', error);
        res.status(500).json({
            error: error.message || 'Failed to scrape product'
        });
    }
});

// Download image endpoint
app.post('/api/download-image', async (req, res) => {
    try {
        const { url, productId, index, productTitle } = req.body;

        if (!url || productId === undefined || index === undefined) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const result = await imageDownloader.downloadImage(url, productId, index, productTitle);

        if (result.success) {
            // Send the file as response
            res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
            res.setHeader('Content-Type', 'image/jpeg');
            
            const fileStream = require('fs').createReadStream(result.filepath);
            fileStream.pipe(res);
            
            // Don't delete file immediately - keep it in the product folder
            // fileStream.on('end', () => {
            //     fs.unlink(result.filepath).catch(console.error);
            // });
        } else {
            res.status(500).json({ error: result.error });
        }

    } catch (error) {
        console.error('Download image API error:', error);
        res.status(500).json({ error: 'Failed to download image' });
    }
});

// Serve static files (PWA assets)
app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'sw.js'));
});

// Serve the main app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Handle 404s
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ===== SERVER STARTUP =====
const server = app.listen(PORT, () => {
    console.log(`🚀 Amazon Product Scraper Server running on port ${PORT}`);
    console.log(`📱 PWA available at: http://localhost:${PORT}`);
    console.log(`🔍 API endpoint: http://localhost:${PORT}/api/scrape`);
    console.log(`📥 Downloads directory: ${DOWNLOADS_DIR}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

module.exports = app;
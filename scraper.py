import urllib.request
import urllib.parse
import json
import re
import time
import os
import threading
import requests
from bs4 import BeautifulSoup
import pandas as pd

class ShopifyScraper:
    def __init__(self):
        self.is_running = False
        self.should_stop = False
        self.status = "idle"  # idle, scanning, scraping, completed, stopped, error
        self.progress_percentage = 0
        self.total_products = 0
        self.scraped_count = 0
        self.current_page = 0
        self.current_action = "Ready to start scraping."
        self.target_url = "https://almakaanstore.com/collections/kitchen-tools"
        self.base_domain = "https://almakaanstore.com"
        self.collection_slug = "kitchen-tools"
        self.products_data = []
        self.logs = []
        self._lock = threading.Lock()

    def add_log(self, message, level="info"):
        timestamp = time.strftime("%H:%M:%S")
        log_entry = {"time": timestamp, "message": message, "level": level}
        with self._lock:
            self.logs.append(log_entry)
            # keep max 500 logs in memory
            if len(self.logs) > 500:
                self.logs.pop(0)

    def parse_shopify_url(self, raw_url):
        raw_url = raw_url.strip()
        parsed = urllib.parse.urlparse(raw_url)
        domain = f"{parsed.scheme}://{parsed.netloc}"
        
        path = parsed.path.rstrip('/')
        if '/collections/' in path:
            collection_slug = path.split('/collections/')[-1].split('/')[0]
        else:
            collection_slug = None
            
        return domain, collection_slug

    def clean_html(self, html_content):
        if not html_content:
            return ""
        soup = BeautifulSoup(html_content, 'html.parser')
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        text = soup.get_text(separator=' ')
        # Break into lines and remove leading and trailing space on each
        lines = (line.strip() for line in text.splitlines())
        # Break multi-headlines into a line each
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        # Drop blank lines
        text = '\n'.join(chunk for chunk in chunks if chunk)
        return text

    def fetch_json(self, url):
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
        }
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            if resp.status_code == 200:
                return resp.json()
            else:
                self.add_log(f"HTTP Request returned status code {resp.status_code} for {url}", "warning")
                return None
        except Exception as e:
            self.add_log(f"HTTP Request failed for {url}: {str(e)}", "error")
            return None

    def process_product_item(self, item, domain):
        try:
            p_id = item.get('id')
            title = item.get('title', '')
            handle = item.get('handle', '')
            vendor = item.get('vendor', '')
            product_type = item.get('product_type', '')
            body_html = item.get('body_html', '')
            tags = item.get('tags', [])
            if isinstance(tags, str):
                tags_list = [t.strip() for t in tags.split(',') if t.strip()]
            else:
                tags_list = tags

            product_url = f"{domain}/products/{handle}" if handle else ""

            # Extract Clean Description
            clean_desc = self.clean_html(body_html)

            # Process Variants
            variants = item.get('variants', [])
            prices = []
            compare_prices = []
            skus = []
            barcodes = []
            in_stock = False
            processed_variants = []

            for v in variants:
                v_price = float(v.get('price') or 0.0)
                v_comp = float(v.get('compare_at_price') or 0.0) if v.get('compare_at_price') else 0.0
                prices.append(v_price)
                if v_comp > 0:
                    compare_prices.append(v_comp)
                
                sku = v.get('sku') or ''
                if sku:
                    skus.append(sku)
                
                barcode = v.get('barcode') or ''
                if barcode:
                    barcodes.append(barcode)
                
                if v.get('available', False):
                    in_stock = True

                processed_variants.append({
                    "id": v.get('id'),
                    "title": v.get('title'),
                    "sku": sku,
                    "price": v_price,
                    "compare_at_price": v_comp if v_comp > 0 else None,
                    "available": v.get('available', False),
                    "barcode": barcode,
                    "grams": v.get('grams', 0)
                })

            min_price = min(prices) if prices else 0.0
            max_price = max(prices) if prices else 0.0
            max_compare = max(compare_prices) if compare_prices else 0.0

            discount_pct = 0
            if max_compare > min_price and max_compare > 0:
                discount_pct = round(((max_compare - min_price) / max_compare) * 100, 1)

            # Images
            images = item.get('images', [])
            image_urls = [img.get('src') for img in images if img.get('src')]
            main_image = image_urls[0] if image_urls else ""

            # Options
            options = item.get('options', [])
            option_names = [opt.get('name') for opt in options if isinstance(opt, dict)]

            return {
                "id": p_id,
                "title": title,
                "handle": handle,
                "url": product_url,
                "vendor": vendor,
                "product_type": product_type,
                "in_stock": in_stock,
                "stock_status": "In Stock" if in_stock else "Out of Stock",
                "price_min": min_price,
                "price_max": max_price,
                "compare_at_price_max": max_compare,
                "discount_percentage": discount_pct,
                "price_display": f"{min_price:.2f} AED" if min_price == max_price else f"{min_price:.2f} - {max_price:.2f} AED",
                "skus": ", ".join(skus),
                "primary_sku": skus[0] if skus else "",
                "barcodes": ", ".join(barcodes),
                "tags": tags_list,
                "tags_str": ", ".join(tags_list),
                "main_image": main_image,
                "all_images": image_urls,
                "images_count": len(image_urls),
                "variant_count": len(processed_variants),
                "variants": processed_variants,
                "options": option_names,
                "description_text": clean_desc,
                "body_html": body_html,
                "created_at": item.get('created_at', ''),
                "updated_at": item.get('updated_at', ''),
                "published_at": item.get('published_at', '')
            }
        except Exception as e:
            self.add_log(f"Error processing item '{item.get('title', 'Unknown')}': {str(e)}", "warning")
            return None

    def run_scrape(self, raw_url=None):
        if raw_url:
            self.target_url = raw_url

        domain, collection_slug = self.parse_shopify_url(self.target_url)
        self.base_domain = domain
        self.collection_slug = collection_slug

        self.is_running = True
        self.should_stop = False
        self.status = "scanning"
        self.progress_percentage = 0
        self.total_products = 0
        self.scraped_count = 0
        self.current_page = 1
        self.products_data = []
        self.logs = []

        self.add_log(f"Starting scraper for target: {self.target_url}")
        self.add_log(f"Domain: {domain} | Collection Slug: {collection_slug or 'All Store Products'}")

        page = 1
        limit = 250
        all_raw_products = []

        # Phase 1: Fetching pages and scanning product items
        while not self.should_stop:
            self.current_page = page
            self.current_action = f"Fetching Page {page} (limit={limit})..."
            
            if collection_slug:
                endpoint = f"{domain}/collections/{collection_slug}/products.json?limit={limit}&page={page}"
            else:
                endpoint = f"{domain}/products.json?limit={limit}&page={page}"

            self.add_log(f"Requesting page {page}: {endpoint}")
            data = self.fetch_json(endpoint)

            if not data or 'products' not in data:
                self.add_log(f"No products found on page {page} or request failed.", "warning")
                break

            products_page = data['products']
            count_page = len(products_page)
            self.add_log(f"Page {page} fetched successfully: {count_page} products found.")

            if count_page == 0:
                break

            all_raw_products.extend(products_page)
            self.total_products = len(all_raw_products)
            self.add_log(f"Total cumulative items discovered: {self.total_products}")

            if count_page < limit:
                # Last page reached
                break

            page += 1
            time.sleep(0.3)

        if self.should_stop:
            self.status = "stopped"
            self.add_log("Scraping operation cancelled by user.", "warning")
            self.is_running = False
            return

        total_to_process = len(all_raw_products)
        self.add_log(f"Scan completed. Total products to process: {total_to_process}")

        if total_to_process == 0:
            self.status = "completed"
            self.progress_percentage = 100
            self.current_action = "No products found."
            self.is_running = False
            return

        # Phase 2: Processing and parsing full product details
        self.status = "scraping"
        processed_list = []

        for idx, item in enumerate(all_raw_products, 1):
            if self.should_stop:
                self.status = "stopped"
                self.add_log("Scraping process stopped by user during processing.", "warning")
                break

            parsed = self.process_product_item(item, domain)
            if parsed:
                processed_list.append(parsed)
                with self._lock:
                    self.products_data = processed_list
                    self.scraped_count = len(processed_list)
                    self.progress_percentage = min(99, int((self.scraped_count / total_to_process) * 100))

            self.current_action = f"Processed {idx}/{total_to_process}: {item.get('title', '')[:40]}"
            if idx % 25 == 0 or idx == total_to_process:
                self.add_log(f"Progress update: {idx}/{total_to_process} products processed ({self.progress_percentage}%)")

        if not self.should_stop:
            self.status = "completed"
            self.progress_percentage = 100
            self.current_action = f"Scraping completed! Successfully scraped {len(processed_list)} products."
            self.add_log(f"Scraping finished successfully! Total products stored: {len(processed_list)}", "success")

        self.is_running = False

    def stop(self):
        if self.is_running:
            self.should_stop = True
            self.add_log("Stop command requested...", "warning")

    def get_state(self):
        with self._lock:
            return {
                "is_running": self.is_running,
                "status": self.status,
                "progress_percentage": self.progress_percentage,
                "total_products": self.total_products,
                "scraped_count": self.scraped_count,
                "current_page": self.current_page,
                "current_action": self.current_action,
                "target_url": self.target_url,
                "logs": self.logs[-50:]  # last 50 logs
            }

    def export_to_dataframe(self):
        with self._lock:
            data = list(self.products_data)

        # Regex to strip illegal Excel control characters (except tab \t, newline \n, return \r)
        illegal_char_re = re.compile(r'[\x00-\x08\x0b-\x0c\x0e-\x1f]')

        flat_rows = []
        for item in data:
            desc = illegal_char_re.sub('', item.get("description_text", ""))
            title = illegal_char_re.sub('', item.get("title", ""))

            row = {
                "Product Title": title,
                "Product Description": desc,
                "Vendor / Brand": item["vendor"],
                "Stock Status": item["stock_status"],
                "Price Min (AED)": item["price_min"],
                "Price Max (AED)": item["price_max"],
                "Compare Price Max": item["compare_at_price_max"],
                "Discount %": item["discount_percentage"],
                "Primary SKU": item["primary_sku"],
                "All SKUs": item["skus"],
                "Barcodes": item["barcodes"],
                "Tags": item["tags_str"],
                "Variants Count": item["variant_count"],
                "Images Count": item["images_count"],
                "Main Image URL": item["main_image"],
                "All Image URLs": ", ".join(item.get("all_images", [])),
                "Product URL": item["url"],
                "Created At": item["created_at"],
                "Updated At": item["updated_at"]
            }
            flat_rows.append(row)
        return pd.DataFrame(flat_rows)

# Global singleton instance
scraper_instance = ShopifyScraper()

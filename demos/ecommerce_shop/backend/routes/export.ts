import express from "express";
import fs from "fs";
import https from "https";
import { db } from "../database/database";
import type { DownloadExportedDesignRequest, ProductDesign } from "../models";
import { writeProduct } from "./product";

const router = express.Router();

const BACKEND_URL = process.env.BACKEND_URL;

const endpoints = {
  DOWNLOAD_EXPORT: "/exports/download",
};

/**
 * NOTE: Exported image urls from Canva expire after some time, so you should
 * download and store the images separately. Here you would normally download
 * and write to your own permanent image storage solution, such as an S3. Here
 * we write to the local file system for demo purposes.
 */
router.post(endpoints.DOWNLOAD_EXPORT, async (req, res) => {
  const requestBody: DownloadExportedDesignRequest = req.body;
  const data = await db.read();

  console.log("Download export request:", requestBody);

  try {
    // First, if a productID is provided return early if no product was found or
    // if no design exists for the product.
    const product = data.products.find(
      (product) => product.id === requestBody.productId,
    );
    if (requestBody.productId) {
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (!product.canvaDesign) {
        return res.status(400).json({ error: "No design found for product" });
      }
    }

    // Second, build the download filename similar to: "3333-838106404244599455.png"
    const exportPathName = new URL(requestBody.exportedDesignUrl).pathname; // e.g. aaa/bbb/1/2/3333-838106404244599455.png
    const fileName = exportPathName.split("/").pop();
    
    console.log("Export path name:", exportPathName);
    console.log("Extracted filename:", fileName);
    
    if (!fileName) {
      throw new Error("Could not extract filename from export URL");
    }

    // __dirname = "...demos/ecommerce_shop/backend/routes" -> replace "/routes"
    // with "public/exports" -> "...demos/ecommerce_shop/backend/public/exports"
    const destinationPath = __dirname.replace("/routes", "/public/exports");

    const destinationFile = `${destinationPath}/${fileName}`;
    const designExportUrl = `${BACKEND_URL}/public/exports/${fileName}`;
    
    console.log("Destination path:", destinationPath);
    console.log("Destination file:", destinationFile);
    console.log("Design export URL:", designExportUrl);

    // Third, check if the exports folder exists, and create it if not.
    if (!fs.existsSync(destinationPath)) {
      console.log("Creating exports directory:", destinationPath);
      fs.mkdirSync(destinationPath, { recursive: true });
    }

    // Fourth, download and save the file
    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(destinationFile);
      console.log("Starting download from:", requestBody.exportedDesignUrl);
      
      const request = https.get(requestBody.exportedDesignUrl, (response) => {
        console.log("Download response status:", response.statusCode);
        if (response.statusCode !== 200) {
          fs.unlink(destinationFile, () => {
            console.error("File not found:", requestBody.exportedDesignUrl);
          });
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
      });

      file.on("finish", () => {
        console.log(`Successfully downloaded: ${fileName}`);
        console.log("File exists after download:", fs.existsSync(destinationFile));
        resolve();
      });

      request.on("error", (err) => {
        fs.unlink(destinationFile, () => {
          console.error("Error downloading file:", err);
        });
        reject(err);
      });

      file.on("error", (err) => {
        fs.unlink(destinationFile, () => {
          console.error("Error writing file:", err);
        });
        reject(err);
      });

      request.end();
    });

    // Update the product with the new export URL if needed
    if (requestBody.productId && product) {
      console.log("Updating product with export URL:", designExportUrl);
      await writeProduct({
        ...product,
        canvaDesign: {
          ...(product.canvaDesign as ProductDesign),
          designExportUrl,
        },
      });
    }

    console.log("Returning download response:", { downloadedExportUrl: designExportUrl });
    return res.json({
      downloadedExportUrl: designExportUrl,
    });
  } catch (error) {
    console.error("Export download error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return res.status(500).json({ 
      error: "Failed to download exported design",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export default router;

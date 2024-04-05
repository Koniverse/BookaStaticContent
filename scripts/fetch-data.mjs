import * as fs from "fs";
import axios from "axios";
import path from "path";
import {writeJSONFile} from "./utils.mjs";

const STRAPI_URL = 'https://content.subwallet.app';
const RESOURCE_URL = 'https://static-data.subwallet.app';

const cacheConfigs = []

const savePath = (folder, fileName) => `data/${folder}/${fileName || 'list.json'}`;
const saveImagesPath = (folder) => `data/${folder}/images`;
const saveFolderChild = (folderParent, folder) => `data/${folderParent}/${folder}`;
const saveFileInFolderChild = (folderParent, folder, fileName) => `data/${folderParent}/${folder}/${fileName}`;
const urlImage = (folder, field, name) => `${RESOURCE_URL}/${folder}/images/${field}/${name}`;

export async function downloadFile(url, downloadDir, forceFileName = null) {
    // Create dir if not exist
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, {recursive: true});
    }

    // Download file with axios
    let fileName = url.split('/').pop();
    if (forceFileName) {
        fileName = forceFileName + '.' + fileName.split('.').pop();
    }
    const filePath = path.join(downloadDir, fileName);

    // Download and save file
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return await new Promise((resolve, reject) => {
        writer.on('finish', () => {
            resolve(fileName);
        });
        writer.on('error', () => {
            resolve(url);
        });
    });
}

const downloadedFiles = {};

const fetchAndProcessData = async (url, folder, downloadDir, fieldsImage) => {
    const results = await axios.get(url);

    if (!results.data) return;

    return await Promise.all(results.data.map(async item => {
        const dataImages = {};
        for (const field of fieldsImage) {
            const dataField = item[field];
            if (dataField) {
                const folderFieldImage = `${downloadDir}/${field}`;
                const imageKey = `${folderFieldImage}---${dataField}`;
                const cachedImage = downloadedFiles[imageKey];
                if (cachedImage) {
                    dataImages[field] = urlImage(folder, field, cachedImage);
                } else {
                    const newFileName = cachedImage || await downloadFile(dataField, folderFieldImage);
                    downloadedFiles[imageKey] = newFileName;
                    dataImages[field] = urlImage(folder, field, newFileName);
                }
            }
        }
        return {...item, ...dataImages};
    }));
}

const getFileNameByLang = (filename, lang) => {
    return lang === '' ? filename : filename.replace('.json', `-${lang}.json`)
}

const getUrl = (url, preview, lang) => {
    if (preview && lang !== '') {
        return `${url}?preview=true&locale=${lang}`
    } else if (preview) {
        return `${url}?preview=true`
    } else if (lang !== '') {
        return `${url}?locale=${lang}`
    } else {
        return url
    }
}

const main = async () => {
    // Filter config by folder
    const environment = process.argv[2];
    const isProduction = environment === 'production';
    const folder = process.argv[3];
    const configs = folder ? cacheConfigs.filter((c) => c.folder === folder) : cacheConfigs;
    for (const config of configs) {
        console.log('Caching data with config', config)
        const langs = [''];
        const folder = config.folder;
        const fieldsImage = config.imageFields;
        const downloadDir = saveImagesPath(folder);

        if (config.langs) {
            langs.push(...config.langs)
        }

        for (const lang of langs) {
            const path = savePath(folder, getFileNameByLang(config.fileName, lang));
            const previewPath = config.preview && savePath(folder, getFileNameByLang(config.preview, lang));

            const dataContent = await fetchAndProcessData(getUrl(config.url, false, lang), folder, downloadDir, fieldsImage);
            const previewData = config.preview && (await fetchAndProcessData(getUrl(config.url, true, lang), folder, downloadDir, fieldsImage));

            if (config.additionalProcess) {
                for (const process of config.additionalProcess) {
                    await process(dataContent, previewData, config, lang, isProduction);
                }
            }

            for (const f of config.removeFields) {
                for (const item of dataContent) {
                    item[f] && delete item[f];
                }
                if (previewData) {
                    for (const item of previewData) {
                        item[f] && delete item[f];
                    }
                }
            }

            isProduction && await writeJSONFile(path, dataContent);
            previewData && await writeJSONFile(previewPath, previewData);
        }
    }
}

main().catch((error) => console.error(error));

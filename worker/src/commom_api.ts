import { Hono } from 'hono'
import { Jwt } from 'hono/utils/jwt'

import utils from './utils';
import { CONSTANTS } from './constants';
import { isS3Enabled } from './mails_api/s3_attachment';
import { isAnySendMailEnabled, newAddress } from './common';

const api = new Hono<HonoCustomType>

api.get('/open_api/settings', async (c) => {
    // check header x-custom-auth
    let needAuth = false;
    const passwords = utils.getPasswords(c);
    if (passwords && passwords.length > 0) {
        const auth = c.req.raw.headers.get("x-custom-auth");
        needAuth = !auth || !passwords.includes(auth);
    }

    return c.json({
        "title": c.env.TITLE,
        "announcement": utils.getStringValue(c.env.ANNOUNCEMENT),
        "alwaysShowAnnouncement": utils.getBooleanValue(c.env.ALWAYS_SHOW_ANNOUNCEMENT),
        "prefix": utils.getStringValue(c.env.PREFIX),
        "addressRegex": utils.getStringValue(c.env.ADDRESS_REGEX),
        "minAddressLen": utils.getIntValue(c.env.MIN_ADDRESS_LEN, 1),
        "maxAddressLen": utils.getIntValue(c.env.MAX_ADDRESS_LEN, 30),
        "defaultDomains": utils.getDefaultDomains(c),
        "domains": utils.getDomains(c),
        "domainLabels": utils.getStringArray(c.env.DOMAIN_LABELS),
        "needAuth": needAuth,
        "adminContact": c.env.ADMIN_CONTACT,
        "enableUserCreateEmail": utils.getBooleanValue(c.env.ENABLE_USER_CREATE_EMAIL),
        "disableAnonymousUserCreateEmail": utils.getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL),
        "disableCustomAddressName": utils.getBooleanValue(c.env.DISABLE_CUSTOM_ADDRESS_NAME),
        "enableUserDeleteEmail": utils.getBooleanValue(c.env.ENABLE_USER_DELETE_EMAIL),
        "enableAutoReply": utils.getBooleanValue(c.env.ENABLE_AUTO_REPLY),
        "enableIndexAbout": utils.getBooleanValue(c.env.ENABLE_INDEX_ABOUT),
        "copyright": c.env.COPYRIGHT,
        "cfTurnstileSiteKey": c.env.CF_TURNSTILE_SITE_KEY,
        "enableWebhook": utils.getBooleanValue(c.env.ENABLE_WEBHOOK),
        "isS3Enabled": isS3Enabled(c),
        "enableSendMail": isAnySendMailEnabled(c),
        "version": CONSTANTS.VERSION,
        "showGithub": !utils.getBooleanValue(c.env.DISABLE_SHOW_GITHUB),
        "disableAdminPasswordCheck": utils.getBooleanValue(c.env.DISABLE_ADMIN_PASSWORD_CHECK),
        "enableAddressPassword": utils.getBooleanValue(c.env.ENABLE_ADDRESS_PASSWORD)
    });
})

api.get('/open_api/address_jwt/:mailbox', async (c) => {
    const mailboxParam = decodeURIComponent(c.req.param("mailbox") || "").trim();
    if (!mailboxParam) {
        return c.text("mailbox is required", 400);
    }

    let localName = mailboxParam;
    let resolvedAddress = "";
    if (mailboxParam.includes("@")) {
        const split = mailboxParam.split("@");
        if (split.length !== 2 || !split[0] || !split[1]) {
            return c.text("Invalid mailbox format", 400);
        }
        resolvedAddress = `${split[0]}@${split[1]}`;
        localName = split[0];
    }

    if (!localName) {
        return c.text("Invalid mailbox format", 400);
    }

    // Priority 1: lock by real "to" address in admin mail module(raw_mails.address)
    // If user uses /localPart, find the latest recipient that matches localPart@*
    if (!resolvedAddress) {
        const latestToAddress = await c.env.DB.prepare(
            `SELECT address FROM raw_mails`
            + ` WHERE lower(address) LIKE ?`
            + ` ORDER BY id DESC LIMIT 1`
        ).bind(`${localName.toLowerCase()}@%`).first<string>("address");
        if (latestToAddress) {
            resolvedAddress = latestToAddress;
        }
    }

    // Priority 2: fallback to configured default domain (old behavior)
    if (!resolvedAddress) {
        const allDomains = utils.getDomains(c);
        if (!allDomains || allDomains.length < 1) {
            return c.text("No domains configured", 400);
        }
        const defaultDomains = utils.getDefaultDomains(c);
        const fallbackDomain = defaultDomains?.[0] || allDomains[0];
        resolvedAddress = `${localName}@${fallbackDomain}`;
    }

    let addressId = await c.env.DB.prepare(
        `SELECT id FROM address where lower(name) = lower(?)`
    ).bind(resolvedAddress).first<number>("id");

    if (!addressId) {
        // create missing address record for direct inbox open
        try {
            await c.env.DB.prepare(
                `INSERT INTO address(name, source_meta) VALUES(?, ?)`
            ).bind(resolvedAddress, 'url').run();
        } catch (error) {
            const msg = (error as Error).message || "";
            // fallback for older schema without source_meta
            if (msg.includes("source_meta")) {
                try {
                    await c.env.DB.prepare(
                        `INSERT INTO address(name) VALUES(?)`
                    ).bind(resolvedAddress).run();
                } catch (insertError) {
                    const insertMsg = (insertError as Error).message || "";
                    if (!insertMsg.includes("UNIQUE")) {
                        console.error("Failed to create address for url route", insertError);
                    }
                }
            } else if (!msg.includes("UNIQUE")) {
                console.error("Failed to create address for url route", error);
            }
        }

        addressId = await c.env.DB.prepare(
            `SELECT id FROM address where lower(name) = lower(?)`
        ).bind(resolvedAddress).first<number>("id");
        if (!addressId && !utils.getBooleanValue(c.env.ENABLE_USER_CREATE_EMAIL)) {
            return c.text("Mailbox does not exist", 404);
        }
        if (!addressId) {
            const split = resolvedAddress.split("@");
            if (split.length !== 2 || !split[0] || !split[1]) {
                return c.text("Invalid mailbox format", 400);
            }
            const created = await newAddress(c, {
                name: split[0],
                domain: split[1],
                enablePrefix: false,
                checkLengthByConfig: true,
                checkAllowDomains: true,
            });
            return c.json(created);
        }
    }

    const jwt = await Jwt.sign({
        address: resolvedAddress,
        address_id: addressId,
    }, c.env.JWT_SECRET, "HS256");
    return c.json({
        address: resolvedAddress,
        jwt,
    });
})

export { api }

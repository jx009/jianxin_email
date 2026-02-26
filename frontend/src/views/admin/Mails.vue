<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router';

import { useGlobalState } from '../../store'
import { api } from '../../api'
import MailBox from '../../components/MailBox.vue';

const { adminMailTabAddress, adminMailQueryNonce } = useGlobalState()
const message = useMessage()
const route = useRoute();
const ROUTE_QUERY_MAIL_DOMAIN = '240623.xyz';

const { t } = useI18n({
    messages: {
        en: {
            addressQueryTip: 'Leave blank to query all addresses',
            query: 'Query',
            invalidQueryBox: 'Invalid box query, expected local-part or *@{domain}',
        },
        zh: {
            addressQueryTip: '留空查询所有地址',
            query: '查询',
            invalidQueryBox: 'box 参数不合法，期望邮箱前缀或 *@{domain}',
        }
    }
});

const mailBoxKey = ref("")

const queryMail = () => {
    adminMailTabAddress.value = adminMailTabAddress.value.trim();
    mailBoxKey.value = Date.now();
}

const parseRouteQueryAddress = () => {
    const boxQuery = Array.isArray(route.query.box)
        ? route.query.box[0]
        : route.query.box;
    if (typeof boxQuery !== 'string') {
        return null;
    }

    const normalizedBox = boxQuery.trim().toLowerCase();
    if (!normalizedBox) {
        return null;
    }

    let localPart = normalizedBox;
    if (normalizedBox.includes('@')) {
        const parts = normalizedBox.split('@');
        if (parts.length !== 2 || parts[1] !== ROUTE_QUERY_MAIL_DOMAIN) {
            return undefined;
        }
        localPart = parts[0];
    }

    if (!/^[a-z0-9]+$/.test(localPart)) {
        return undefined;
    }

    return `${localPart}@${ROUTE_QUERY_MAIL_DOMAIN}`;
}

const lastRouteAddress = ref("");
const applyRouteBoxFilter = () => {
    const routeAddress = parseRouteQueryAddress();
    if (routeAddress === null) {
        return;
    }
    if (routeAddress === undefined) {
        message.error(t('invalidQueryBox', { domain: ROUTE_QUERY_MAIL_DOMAIN }));
        return;
    }
    if (lastRouteAddress.value === routeAddress) {
        return;
    }
    adminMailTabAddress.value = routeAddress;
    lastRouteAddress.value = routeAddress;
    queryMail();
}

watch(() => route.query.box, () => {
    applyRouteBoxFilter();
}, { immediate: true });

watch(() => adminMailQueryNonce.value, (nonce) => {
    if (!nonce) {
        return;
    }
    queryMail();
}, { immediate: true });

const fetchMailData = async (limit, offset) => {
    return await api.fetch(
        `/admin/mails`
        + `?limit=${limit}`
        + `&offset=${offset}`
        + (adminMailTabAddress.value ? `&address=${adminMailTabAddress.value}` : '')
    );
}

const deleteMail = async (curMailId) => {
    await api.fetch(`/admin/mails/${curMailId}`, { method: 'DELETE' });
};
</script>

<template>
    <div style="margin-top: 10px;">
        <n-input-group>
            <n-input v-model:value="adminMailTabAddress" :placeholder="t('addressQueryTip')"
                @keydown.enter="queryMail" clearable />
            <n-button @click="queryMail" type="primary" tertiary>
                {{ t('query') }}
            </n-button>
        </n-input-group>
        <div style="margin-top: 10px;"></div>
        <MailBox :key="mailBoxKey" :enableUserDeleteEmail="true" :fetchMailData="fetchMailData"
            :deleteMail="deleteMail" :showFilterInput="true" />
    </div>
</template>

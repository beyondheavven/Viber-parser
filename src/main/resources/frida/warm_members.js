/**
 * Frida-скрипт «прогрева» участников группы Viber.
 *
 * Заменяет UI-обход: вместо кликов по каждому участнику мы вызываем внутренний метод
 * Viber, который открывает чат с участником. Именно это действие заставляет Viber
 * заполнить номер/имя участника в своей базе (participants_info), откуда данные потом
 * читаются через adb+sqlite3.
 *
 * conversationId приходит через переменную окружения VIBER_CONVERSATION_ID (её задаёт
 * FridaViberWarmer). Скрипт обязан напечатать в stdout одну строку JSON:
 *
 *     {"warmed": N}
 *
 * где N — число обработанных участников. FridaViberWarmer.parseWarmed читает именно её.
 *
 * -----------------------------------------------------------------------------------
 * ВАЖНО: имена классов/методов ниже — ГИПОТЕЗЫ. Viber обфусцирован (ProGuard), реальные
 * сигнатуры надо найти реверс-инжинирингом APK:
 *
 *   1. Декомпилировать APK:  jadx -d out viber.apk
 *   2. Найти метод, который вызывается при открытии чата с участником (поиск по
 *      "openConversation", "startChat", "ConversationActivity", "openChat").
 *   3. Подставить реальное имя класса и метода в WARM_METHOD ниже.
 *
 * Альтернатива без знания имён — frida-trace для обнаружения вызовов в момент ручного
 * открытия чата:
 *
 *   frida-trace -U -n com.viber.voip -j '*open*' -j '*chat*'
 * -----------------------------------------------------------------------------------
 */

'use strict';

var CONVERSATION_ID = Process.env.VIBER_CONVERSATION_ID;

// --- ГИПОТЕЗЫ: подставить реальные имена после реверс-инжиниринга -------------------
var WARM_CLASS = 'com.viber.voip.messages.controller.ConversationController';
var WARM_METHOD = 'openConversation';
// -----------------------------------------------------------------------------------

function warmMembers(conversationId) {
    Java.perform(function () {
        var Controller = Java.use(WARM_CLASS);
        var controller = Controller.$new(); // или получить существующий инстанс через singleton

        // Список участников берём из базы Viber напрямую (через adb+sqlite3 это уже умеет
        // делать сервер), но для автономности скрипт может сам дёрнуть метод получения
        // участников. Здесь — заглушка: реальный способ получить memberId каждого участника
        // зависит от того, что вернёт реверс-инжиниринг.
        var memberIds = getMemberIds(conversationId);

        var warmed = 0;
        memberIds.forEach(function (memberId) {
            try {
                controller[WARM_METHOD](conversationId, memberId);
                warmed++;
            } catch (e) {
                send({ type: 'warn', message: 'failed to warm ' + memberId + ': ' + e });
            }
        });

        // Единственная строка, которую читает FridaViberWarmer.parseWarmed.
        console.log(JSON.stringify({ warmed: warmed }));
    });
}

/**
 * Получить memberId участников группы. Реальный способ зависит от внутреннего API Viber;
 * здесь — заглушка, которую надо заменить на вызов метода Viber, возвращающего участников
 * группы по conversationId (или на чтение из базы, если сервер передаст список).
 */
function getMemberIds(conversationId) {
    // TODO: заменить на реальный вызов Viber API.
    return [];
}

warmMembers(CONVERSATION_ID);

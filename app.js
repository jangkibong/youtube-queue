const STORAGE_KEY = "yt-queue-board-v1";
const ALL_FILTER = "__ALL__";

const state = {
    items: [],
    orders: { [ALL_FILTER]: [] },
    selectedFilter: ALL_FILTER,
    currentVideoId: null,
    repeatAll: false,
    playerReady: false,
    isPlaying: false,
};

const els = {
    addForm: document.getElementById("addForm"),
    urlInput: document.getElementById("urlInput"),
    titleInput: document.getElementById("titleInput"),
    tagsInput: document.getElementById("tagsInput"),
    queueList: document.getElementById("queueList"),
    tagFilterContainer: document.getElementById("tagFilterContainer"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    currentFilterBadge: document.getElementById("currentFilterBadge"),
    queueCount: document.getElementById("queueCount"),
    emptyState: document.getElementById("emptyState"),
    nowPlayingTitle: document.getElementById("nowPlayingTitle"),
    nowPlayingMeta: document.getElementById("nowPlayingMeta"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    playPauseBtn: document.getElementById("playPauseBtn"),
    repeatBtn: document.getElementById("repeatBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importInput: document.getElementById("importInput"),
    editDialog: document.getElementById("editDialog"),
    editForm: document.getElementById("editForm"),
    closeEditDialogBtn: document.getElementById("closeEditDialogBtn"),
    editId: document.getElementById("editId"),
    editTitle: document.getElementById("editTitle"),
    editTags: document.getElementById("editTags"),
    queueItemTemplate: document.getElementById("queueItemTemplate"),
    runtimeNotice: document.getElementById("runtimeNotice"),
};

let player = null;
let draggedId = null;

function isHttpContext() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function updateRuntimeNotice() {
    if (isHttpContext()) {
        els.runtimeNotice.hidden = true;
        els.runtimeNotice.innerHTML = "";
        return;
    }

    els.runtimeNotice.hidden = false;
    els.runtimeNotice.innerHTML =
        "<strong>현재 파일을 직접 열고 있습니다.</strong> YouTube 오류 153은 file:// 환경이나 referrer가 없는 환경에서 자주 발생합니다. 이 파일은 로컬에서 바로 열기보다 GitHub Pages, Netlify, Vercel 또는 간단한 로컬 서버(http://localhost)로 실행해야 정상 동작할 가능성이 높습니다.";
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        state.items = Array.isArray(parsed.items)
            ? parsed.items.filter((item) => !item.isHardcoded)
            : [];
        state.orders =
            parsed.orders && typeof parsed.orders === "object"
                ? parsed.orders
                : { [ALL_FILTER]: [] };
        state.selectedFilter = parsed.selectedFilter || ALL_FILTER;
        state.repeatAll = Boolean(parsed.repeatAll);
        state.currentVideoId = parsed.currentVideoId || null;
        state.isPlaying = false;
    } catch (error) {
        console.error("저장된 데이터를 불러오지 못했습니다.", error);
    }
}

function saveState() {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            items: state.items.filter((item) => !item.isHardcoded),
            orders: state.orders,
            selectedFilter: state.selectedFilter,
            repeatAll: state.repeatAll,
            currentVideoId: state.currentVideoId,
        }),
    );
}

function extractVideoId(input) {
    try {
        const url = new URL(input);
        if (url.hostname.includes("youtu.be")) {
            return url.pathname.replace("/", "").trim() || null;
        }
        if (url.pathname.startsWith("/shorts/")) {
            return url.pathname.split("/shorts/")[1]?.split("/")[0] || null;
        }
        if (url.pathname.startsWith("/embed/")) {
            return url.pathname.split("/embed/")[1]?.split("/")[0] || null;
        }
        return url.searchParams.get("v");
    } catch {
        return null;
    }
}

function normalizeTags(raw) {
    const source = Array.isArray(raw) ? raw : String(raw || "").split(",");
    return [...new Set(source.map((tag) => String(tag).trim()).filter(Boolean))];
}

function createItem({ url, title, tags }) {
    const videoId = extractVideoId(url);
    if (!videoId) {
        throw new Error("유효한 유튜브 링크가 아닙니다.");
    }

    const cleanTags = normalizeTags(tags || "");
    return {
        id: crypto.randomUUID(),
        videoId,
        url,
        title: title?.trim() || `YouTube 영상 (${videoId})`,
        tags: cleanTags,
        createdAt: Date.now(),
        isHardcoded: false,
    };
}

function createHardcodedItem(entry, index) {
    const videoId = extractVideoId(entry?.url || "");
    if (!videoId) return null;

    return {
        id: `hc-${videoId}-${index}`,
        videoId,
        url: entry.url,
        title: String(entry.title || `YouTube 영상 (${videoId})`).trim(),
        tags: normalizeTags(entry.tags || []),
        createdAt: 0,
        isHardcoded: true,
    };
}

function getHardcodedItems() {
    const list = Array.isArray(window.HARDCODED_PLAYLIST) ? window.HARDCODED_PLAYLIST : [];
    return list.map((entry, index) => createHardcodedItem(entry, index)).filter(Boolean);
}

function mergeHardcodedItems() {
    const manualItems = state.items.filter((item) => !item.isHardcoded);
    state.items = [...getHardcodedItems(), ...manualItems];
}

function getAllTags() {
    const tags = new Set();
    state.items.forEach((item) => item.tags.forEach((tag) => tags.add(tag)));
    return [...tags].sort((a, b) => a.localeCompare(b, "ko"));
}

function getFilterLabel(filterKey) {
    return filterKey === ALL_FILTER ? "전체" : `태그: ${filterKey}`;
}

function ensureAllOrder() {
    const allIds = state.items.map((item) => item.id);
    const existing = Array.isArray(state.orders[ALL_FILTER]) ? state.orders[ALL_FILTER] : [];
    const set = new Set(existing.filter((id) => allIds.includes(id)));
    const merged = [
        ...existing.filter((id) => allIds.includes(id)),
        ...allIds.filter((id) => !set.has(id)),
    ];
    state.orders[ALL_FILTER] = merged;
}

function pruneOrders() {
    const validIds = new Set(state.items.map((item) => item.id));
    Object.keys(state.orders).forEach((filterKey) => {
        state.orders[filterKey] = (state.orders[filterKey] || []).filter((id) => validIds.has(id));
        if (filterKey !== ALL_FILTER && state.orders[filterKey].length === 0) {
            const tagStillExists = getAllTags().includes(filterKey);
            if (!tagStillExists) delete state.orders[filterKey];
        }
    });
    ensureAllOrder();
}

function getVisibleItems(filterKey = state.selectedFilter) {
    if (filterKey === ALL_FILTER) return [...state.items];
    return state.items.filter((item) => item.tags.includes(filterKey));
}

function getOrderedVisibleItems(filterKey = state.selectedFilter) {
    const visibleItems = getVisibleItems(filterKey);
    const visibleMap = new Map(visibleItems.map((item) => [item.id, item]));
    const customOrder = state.orders[filterKey] || [];
    const ordered = customOrder.map((id) => visibleMap.get(id)).filter(Boolean);
    const existingIds = new Set(ordered.map((item) => item.id));
    const rest = visibleItems.filter((item) => !existingIds.has(item.id));
    return [...ordered, ...rest];
}

function setFilter(filterKey) {
    state.selectedFilter = filterKey;
    els.currentFilterBadge.textContent = getFilterLabel(filterKey);
    saveState();
    render();
}

function updateNowPlayingUI() {
    const currentItem = state.items.find((item) => item.id === state.currentVideoId);
    if (!currentItem) {
        els.nowPlayingTitle.textContent = "재생할 영상을 선택해 주세요";
        els.nowPlayingMeta.textContent = "태그 없음";
        return;
    }
    els.nowPlayingTitle.textContent = currentItem.title;
    els.nowPlayingMeta.textContent = currentItem.tags.length
        ? currentItem.tags.join(" · ")
        : "태그 없음";
}

function renderFilters() {
    const tags = getAllTags();
    els.tagFilterContainer.innerHTML = "";

    document.querySelectorAll(".tag-chip[data-filter]").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === state.selectedFilter);
    });

    tags.forEach((tag) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `tag-chip ${state.selectedFilter === tag ? "active" : ""}`;
        button.dataset.filter = tag;
        button.textContent = tag;
        button.addEventListener("click", () => setFilter(tag));
        els.tagFilterContainer.appendChild(button);
    });
}

function renderQueue() {
    const items = getOrderedVisibleItems();
    els.queueList.innerHTML = "";
    els.queueCount.textContent = `${items.length}개 영상`;
    els.emptyState.style.display = items.length ? "none" : "block";

    items.forEach((item) => {
        const fragment = els.queueItemTemplate.content.cloneNode(true);
        const li = fragment.querySelector(".queue-item");
        const itemMain = fragment.querySelector(".item-main");
        const itemThumb = fragment.querySelector(".item-thumb");
        const title = fragment.querySelector(".item-title");
        const url = fragment.querySelector(".item-url");
        const tags = fragment.querySelector(".item-tags");
        const editBtn = fragment.querySelector(".edit-btn");
        const deleteBtn = fragment.querySelector(".delete-btn");

        li.dataset.id = item.id;
        if (item.id === state.currentVideoId) li.classList.add("current");

        title.textContent = item.title;
        url.textContent = item.url;
        itemThumb.src = `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
        itemThumb.alt = `${item.title} 썸네일`;
        itemThumb.addEventListener("error", () => {
            if (itemThumb.dataset.fallbackApplied === "true") return;
            itemThumb.dataset.fallbackApplied = "true";
            itemThumb.src = `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;
        });
        if (item.tags.length) {
            item.tags.forEach((tag) => {
                const chip = document.createElement("span");
                chip.textContent = tag;
                tags.appendChild(chip);
            });
        } else {
            const chip = document.createElement("span");
            chip.textContent = "태그 없음";
            tags.appendChild(chip);
        }

        if (item.isHardcoded) {
            const hardcodedChip = document.createElement("span");
            // hardcodedChip.textContent = '하드코딩';
            // tags.appendChild(hardcodedChip);
            editBtn.disabled = true;
            deleteBtn.disabled = true;
            editBtn.textContent = "fix";
            deleteBtn.textContent = "fix";
            // editBtn.title = "fix 항목은 seed-data.js에서 수정하세요.";
            // deleteBtn.title = "fix 항목은 seed-data.js에서 삭제하세요.";
        }

        itemMain.addEventListener("click", () => playItem(item.id, true));
        editBtn.addEventListener("click", () => openEditDialog(item.id));
        deleteBtn.addEventListener("click", () => deleteItem(item.id));

        li.addEventListener("dragstart", handleDragStart);
        li.addEventListener("dragover", handleDragOver);
        li.addEventListener("drop", handleDrop);
        li.addEventListener("dragend", handleDragEnd);

        els.queueList.appendChild(fragment);
    });
}

function renderRepeatButton() {
    els.repeatBtn.classList.toggle("active", state.repeatAll);
    els.repeatBtn.textContent = state.repeatAll ? "전체 반복 켜짐" : "전체 반복 꺼짐";
}

function render() {
    renderFilters();
    renderQueue();
    renderRepeatButton();
    updateNowPlayingUI();
}

function reorderVisibleItems(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const visibleOrdered = getOrderedVisibleItems();
    const sourceIndex = visibleOrdered.findIndex((item) => item.id === sourceId);
    const targetIndex = visibleOrdered.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const cloned = [...visibleOrdered];
    const [moved] = cloned.splice(sourceIndex, 1);
    cloned.splice(targetIndex, 0, moved);

    if (state.selectedFilter === ALL_FILTER) {
        state.orders[ALL_FILTER] = cloned.map((item) => item.id);
    } else {
        state.orders[state.selectedFilter] = cloned.map((item) => item.id);
    }

    saveState();
    renderQueue();
}

function handleDragStart(event) {
    draggedId = event.currentTarget.dataset.id;
    event.currentTarget.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
}

function handleDrop(event) {
    event.preventDefault();
    const targetId = event.currentTarget.dataset.id;
    reorderVisibleItems(draggedId, targetId);
}

function handleDragEnd(event) {
    event.currentTarget.classList.remove("dragging");
    draggedId = null;
}

function addItem(item) {
    state.items.push(item);
    ensureAllOrder();
    item.tags.forEach((tag) => {
        if (!state.orders[tag]) state.orders[tag] = [];
        state.orders[tag].push(item.id);
    });
    saveState();
    render();
}

function deleteItem(itemId) {
    const target = state.items.find((item) => item.id === itemId);
    if (!target) return;
    if (target.isHardcoded) {
        alert("하드코딩 항목은 seed-data.js에서 삭제해 주세요.");
        return;
    }

    const confirmed = window.confirm(`'${target.title}' 항목을 삭제할까요?`);
    if (!confirmed) return;

    state.items = state.items.filter((item) => item.id !== itemId);
    pruneOrders();

    if (state.currentVideoId === itemId) {
        const visible = getOrderedVisibleItems();
        state.currentVideoId = visible[0]?.id || null;
        if (state.currentVideoId) {
            playItem(state.currentVideoId, false);
        } else if (player && state.playerReady) {
            player.stopVideo();
        }
    }

    saveState();
    render();
}

function openEditDialog(itemId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;
    if (item.isHardcoded) {
        alert("하드코딩 항목은 seed-data.js에서 수정해 주세요.");
        return;
    }
    els.editId.value = item.id;
    els.editTitle.value = item.title;
    els.editTags.value = item.tags.join(", ");
    els.editDialog.showModal();
}

function updateItem(itemId, { title, tags }) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item || item.isHardcoded) return;

    item.title = title.trim() || item.title;
    item.tags = normalizeTags(tags);
    pruneOrders();
    item.tags.forEach((tag) => {
        if (!state.orders[tag]) state.orders[tag] = [];
        if (!state.orders[tag].includes(item.id)) state.orders[tag].push(item.id);
    });

    if (state.selectedFilter !== ALL_FILTER && !item.tags.includes(state.selectedFilter)) {
        state.selectedFilter = ALL_FILTER;
    }

    saveState();
    render();
}

function getCurrentVisibleQueue() {
    return getOrderedVisibleItems(state.selectedFilter);
}

function getNeighborItem(step) {
    const queue = getCurrentVisibleQueue();
    if (!queue.length) return null;
    const currentIndex = queue.findIndex((item) => item.id === state.currentVideoId);
    if (currentIndex === -1) return queue[0];

    const nextIndex = currentIndex + step;
    if (nextIndex >= 0 && nextIndex < queue.length) return queue[nextIndex];
    if (state.repeatAll) {
        if (nextIndex < 0) return queue[queue.length - 1];
        if (nextIndex >= queue.length) return queue[0];
    }
    return null;
}

function playItem(itemId, autoplay = true) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;

    state.currentVideoId = item.id;
    updateNowPlayingUI();
    saveState();
    renderQueue();

    if (!player || !state.playerReady) return;

    if (!autoplay) {
        player.cueVideoById({ videoId: item.videoId, startSeconds: 0 });
        state.isPlaying = false;
        els.playPauseBtn.textContent = "재생";
    } else {
        player.loadVideoById({ videoId: item.videoId, startSeconds: 0 });
        state.isPlaying = true;
        els.playPauseBtn.textContent = "일시정지";
    }
}

function togglePlayPause() {
    if (!player || !state.playerReady || !state.currentVideoId) return;
    if (state.isPlaying) {
        player.pauseVideo();
    } else {
        player.playVideo();
    }
}

function playNext() {
    const nextItem = getNeighborItem(1);
    if (nextItem) playItem(nextItem.id, true);
}

function playPrev() {
    const prevItem = getNeighborItem(-1);
    if (prevItem) playItem(prevItem.id, true);
}

function exportData() {
    const payload = {
        exportedAt: new Date().toISOString(),
        items: state.items.filter((item) => !item.isHardcoded),
        orders: state.orders,
        selectedFilter: state.selectedFilter,
        repeatAll: state.repeatAll,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "youtube-queue-data.json";
    link.click();
    URL.revokeObjectURL(url);
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            state.items = Array.isArray(parsed.items)
                ? parsed.items.filter((item) => !item.isHardcoded)
                : [];
            state.orders =
                parsed.orders && typeof parsed.orders === "object"
                    ? parsed.orders
                    : { [ALL_FILTER]: [] };
            state.selectedFilter = parsed.selectedFilter || ALL_FILTER;
            state.repeatAll = Boolean(parsed.repeatAll);
            state.currentVideoId = null;
            mergeHardcodedItems();
            pruneOrders();
            saveState();
            render();
            alert("데이터를 가져왔습니다.");
        } catch (error) {
            console.error(error);
            alert("가져오기 파일을 읽을 수 없습니다.");
        }
    };
    reader.readAsText(file);
}

function bindEvents() {
    els.addForm.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
            const item = createItem({
                url: els.urlInput.value.trim(),
                title: els.titleInput.value.trim(),
                tags: els.tagsInput.value,
            });
            addItem(item);
            els.addForm.reset();
            if (!state.currentVideoId) playItem(item.id, false);
        } catch (error) {
            alert(error.message);
        }
    });

    els.clearFilterBtn.addEventListener("click", () => setFilter(ALL_FILTER));
    els.prevBtn.addEventListener("click", playPrev);
    els.nextBtn.addEventListener("click", playNext);
    els.playPauseBtn.addEventListener("click", togglePlayPause);
    els.repeatBtn.addEventListener("click", () => {
        state.repeatAll = !state.repeatAll;
        saveState();
        renderRepeatButton();
    });
    els.exportBtn.addEventListener("click", exportData);
    els.importInput.addEventListener("change", (event) => {
        const [file] = event.target.files || [];
        if (file) importData(file);
        event.target.value = "";
    });

    els.editForm.addEventListener("submit", (event) => {
        event.preventDefault();
        updateItem(els.editId.value, {
            title: els.editTitle.value,
            tags: els.editTags.value,
        });
        els.editDialog.close();
    });

    els.closeEditDialogBtn.addEventListener("click", () => els.editDialog.close());
    document
        .querySelector('.tag-chip[data-filter="__ALL__"]')
        .addEventListener("click", () => setFilter(ALL_FILTER));
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
    const playerVars = {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
    };

    if (isHttpContext()) {
        playerVars.origin = window.location.origin;
    }

    player = new YT.Player("player", {
        width: "100%",
        height: "100%",
        videoId: "",
        host: "https://www.youtube.com",
        playerVars,
        events: {
            onReady: () => {
                state.playerReady = true;
                if (state.currentVideoId) {
                    const item = state.items.find((entry) => entry.id === state.currentVideoId);
                    if (item) {
                        player.cueVideoById(item.videoId);
                        updateNowPlayingUI();
                    }
                }
            },
            onStateChange: (event) => {
                if (event.data === YT.PlayerState.PLAYING) {
                    state.isPlaying = true;
                    els.playPauseBtn.textContent = "일시정지";
                }
                if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.CUED) {
                    state.isPlaying = false;
                    els.playPauseBtn.textContent = "재생";
                }
                if (event.data === YT.PlayerState.ENDED) {
                    const nextItem = getNeighborItem(1);
                    if (nextItem) playItem(nextItem.id, true);
                    else {
                        state.isPlaying = false;
                        els.playPauseBtn.textContent = "재생";
                    }
                }
            },
        },
    });
};

loadState();
mergeHardcodedItems();
ensureAllOrder();
pruneOrders();
updateRuntimeNotice();
bindEvents();
render();
updateNowPlayingUI();

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import EventBasicDetails from "../../components/organizer/EventBasicDetails";
import EventTimeLocation from "../../components/organizer/EventTimeLocation";
import EventRegistrationType from "../../components/organizer/EventRegistrationType";
import ChipMultiSelect from "../../components/organizer/ChipMultiSelect";
import { getApiErrorMessage, requestJson } from "../../api/http";
import "./css/CreateEvent.css";

function CreateEvent() {
    const navigate = useNavigate()

    const [faculties, setFaculties] = useState([]);
    const [tags, setTags] = useState([]);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    const [startDatetime, setStartDatetime] = useState("");
    const [endDatetime, setEndDatetime] = useState("");
    const [registrationType, setRegistrationType] = useState("built_in");
    const [capacity, setCapacity] = useState("");
    const [externalUrl, setExternalUrl] = useState("");
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedFaculties, setSelectedFaculties] = useState([]);

    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        async function loadData() {
            try {
                const [facultiesData, tagsData] = await Promise.all([
                    requestJson("/api/faculties"),
                    requestJson("/api/tags"),
                ]);
                setFaculties(facultiesData);
                setTags(tagsData);
            } catch (error) {
                setError(getApiErrorMessage(error, "Failed to load faculties and tags"));
            }
        }
        loadData();
    }, []);

    const toggleTag = (id) =>
        setSelectedTags((prev) => 
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]    
        );

    const toggleFaculty = (id) =>
        setSelectedFaculties((prev) => 
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]    
        );

    const validate = () => {
        if (!title || !location || !startDatetime || !endDatetime) {
            setError("Title, location, start and end date/time are required");
            return;
        }
        if (selectedTags.length === 0) {
            setError("Select at least one tag");
            return;
        }
        if (selectedFaculties.length === 0) {
            setError("Select at least one target faculty");
            return;
        }
        if (registrationType === "external" && !externalUrl) {
            setError("An external registration link is required");
            return;
        }
        return true;
    };
        
    const createEvent = async () => {
        try {
            const data = await requestJson("/api/organizer/events", {
                method: "POST",
                body: {
                    title, description, location,
                    start_datetime: startDatetime,
                    end_datetime: endDatetime,
                    registration_type: registrationType,
                    capacity: registrationType === "built_in" && capacity ? Number(capacity) : null,
                    external_url: registrationType === "external" ? externalUrl : null,
                    tag_ids: selectedTags,
                    target_faculty_ids: selectedFaculties,
                },
            });
            return data.eventId;
        } catch (error) {
            setError(getApiErrorMessage(error, "Something went wrong. Please try again."));
            return null;
        }
    };

    const handleSaveDraft = async () => {
        setError("");
        if (!validate()) return;

        setLoading(true);
        const id = await createEvent();
        if (!id) {
            setLoading(false);
            return;
        }
        navigate("/organizer");
    };

    const handleSubmit = async () => {
        setError("");
        if (!validate()) return;

        setLoading(true);
        const id = await createEvent();
        if (!id) {
            setLoading(false);
            return;
        }

        try {
            await requestJson(`/api/organizer/events/${id}/submit`, {
                method: "POST",
            });
            navigate("/organizer");
        } catch (error) {
            setError(getApiErrorMessage(error, "Created as draft, but couldn't submit it"));
            setLoading(false);
        }
    };

    return (
        <div className="create-event">
            <div className="create-event-header">
                <h1>Create New Event</h1>
                <div className="create-event-actions">
                    <button className="btn-secondary" onClick={handleSaveDraft} disabled={loading}>
                        Save Draft
                    </button>
                    <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
                        {loading ? "Working..." : "Submit for approval"}
                    </button>
                </div>
            </div>

            {error && <p className="error-text">{error}</p>}

            <EventBasicDetails 
                title={title}
                description={description}
                onTitleChange={setTitle}
                onDescriptionChange={setDescription}
            />

            <EventTimeLocation
                location={location}
                startDatetime={startDatetime}
                endDatetime={endDatetime}
                onLocationChange={setLocation}
                onStartChange={setStartDatetime}
                onEndChange={setEndDatetime}
            />

            <EventRegistrationType 
                registrationType={registrationType}
                capacity={capacity}
                externalUrl={externalUrl}
                onTypeChange={setRegistrationType}
                onCapacityChange={setCapacity}
                onExternalUrlChange={setExternalUrl}
            />

            <ChipMultiSelect 
                title="Tags"
                required
                items={tags}
                selectedIds={selectedTags}
                onToggle={toggleTag}
            />

            <ChipMultiSelect 
                title="Target Faculties"
                required
                items={faculties}
                selectedIds={selectedFaculties}
                onToggle={toggleFaculty}
            />
        </div>
    );
}

export default CreateEvent;
